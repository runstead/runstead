import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

import { z } from "zod";

import {
  buildDomainPackManifest,
  type DomainPackManifest,
  type DomainPackManifestFile,
  verifyDomainPackManifest
} from "./manifest.js";
import { validateDomainPackDir } from "./validator.js";

export interface DomainPackBundleArtifactFile extends DomainPackManifestFile {
  contentsBase64: string;
}

export interface DomainPackBundleArtifact {
  schemaVersion: 1;
  manifest: DomainPackManifest;
  files: DomainPackBundleArtifactFile[];
}

export interface ExtractDomainPackBundleOptions {
  bundle: unknown;
  outputDir: string;
  force?: boolean;
}

export interface ExtractDomainPackBundleResult {
  outputDir: string;
  manifestPath: string;
  files: string[];
}

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const Base64Schema = z
  .string()
  .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/);

const DomainPackBundleArtifactFileSchema = z.object({
  path: z.string().min(1),
  bytes: z.number().int().nonnegative(),
  sha256: Sha256Schema,
  contentsBase64: Base64Schema
});

const DomainPackBundleArtifactSchema: z.ZodType<DomainPackBundleArtifact> = z.object({
  schemaVersion: z.literal(1),
  manifest: z.object({
    schemaVersion: z.literal(1),
    domain: z.object({
      id: z.string().min(1),
      version: z.string().min(1),
      name: z.string().min(1),
      schemaVersion: z.number().int().positive().optional()
    }),
    compatibility: z.object({
      runsteadMinVersion: z.string().min(1),
      runsteadMaxVersion: z.string().min(1).optional()
    }),
    defaultPolicy: z.string().min(1),
    goalTemplates: z.array(z.string().min(1)),
    taskTypes: z.array(z.string().min(1)),
    fixtures: z.array(z.string().min(1)),
    evals: z.array(z.string().min(1)),
    requiredTools: z.array(z.string().min(1)),
    supportedWorkers: z.array(z.string().min(1)),
    migrations: z
      .array(
        z.object({
          fromVersion: z.string().min(1),
          toVersion: z.string().min(1),
          description: z.string().min(1),
          steps: z.array(z.string().min(1))
        })
      )
      .default([]),
    repoTemplates: z
      .array(
        z.object({
          id: z.string().min(1),
          label: z.string().min(1),
          description: z.string().min(1),
          requiredSignals: z.array(z.string().min(1))
        })
      )
      .default([]),
    gateThresholds: z
      .record(
        z.string(),
        z.object({
          maxCriticalBlockers: z.number().int().nonnegative().optional(),
          maxMajorBlockers: z.number().int().nonnegative().optional(),
          minimumEvidenceCompleteness: z.number().min(0).max(1).optional(),
          minimumReportQuality: z.number().min(0).max(1).optional()
        })
      )
      .default({}),
    reportSections: z
      .array(
        z.object({
          id: z.string().min(1),
          title: z.string().min(1),
          description: z.string().min(1),
          evidenceTypes: z.array(z.string().min(1))
        })
      )
      .default([]),
    capabilityPolicy: z
      .object({
        reads: z.array(z.string().min(1)),
        writes: z.array(z.string().min(1)),
        approvalsRequired: z.array(z.string().min(1)),
        denied: z.array(z.string().min(1))
      })
      .optional(),
    evidenceContracts: z
      .array(
        z.object({
          workflow: z.string().min(1),
          outputs: z.array(z.string().min(1)),
          completionCriteria: z.array(z.string().min(1))
        })
      )
      .default([]),
    evidenceRequirementEvaluators: z
      .array(
        z.object({
          requirement: z.string().min(1),
          description: z.string().min(1).optional(),
          evidenceTypes: z.array(z.string().min(1)),
          taskTypes: z.array(z.string().min(1)),
          taskStatuses: z.array(z.string().min(1)),
          eventTypes: z.array(z.string().min(1)),
          match: z.enum(["any", "all"])
        })
      )
      .default([]),
    evalQuality: z
      .object({
        minimumScore: z.number().min(0).max(1),
        requiredContracts: z.array(z.string().min(1))
      })
      .optional(),
    files: z.array(
      z.object({
        path: z.string().min(1),
        bytes: z.number().int().nonnegative(),
        sha256: Sha256Schema
      })
    )
  }),
  files: z.array(DomainPackBundleArtifactFileSchema)
});

export async function buildDomainPackBundle(
  root: string
): Promise<DomainPackBundleArtifact> {
  const manifest = await buildDomainPackManifest(root);
  const files = await Promise.all(
    manifest.files.map(async (file): Promise<DomainPackBundleArtifactFile> => {
      const contents = await readFile(resolve(root, file.path));

      return {
        ...file,
        contentsBase64: contents.toString("base64")
      };
    })
  );

  return {
    schemaVersion: 1,
    manifest,
    files
  };
}

export function parseDomainPackBundle(input: unknown): DomainPackBundleArtifact {
  return DomainPackBundleArtifactSchema.parse(input);
}

export function serializeDomainPackBundle(bundle: DomainPackBundleArtifact): string {
  return `${JSON.stringify(parseDomainPackBundle(bundle), null, 2)}\n`;
}

export async function extractDomainPackBundle(
  options: ExtractDomainPackBundleOptions
): Promise<ExtractDomainPackBundleResult> {
  const bundle = parseDomainPackBundle(options.bundle);
  const outputDir = resolve(options.outputDir);
  const manifestFiles = new Map(
    bundle.manifest.files.map((file) => [normalizeBundlePath(file.path), file])
  );
  const bundleFiles = new Map<string, DomainPackBundleArtifactFile>();

  for (const file of bundle.files) {
    const normalizedPath = normalizeBundlePath(file.path);
    const expected = manifestFiles.get(normalizedPath);

    if (expected === undefined) {
      throw new Error(
        `Domain pack bundle file is not listed in manifest: ${file.path}`
      );
    }

    if (bundleFiles.has(normalizedPath)) {
      throw new Error(`Duplicate domain pack bundle file: ${normalizedPath}`);
    }

    assertMatchingBundleFile(file, expected);
    bundleFiles.set(normalizedPath, {
      ...file,
      path: normalizedPath
    });
  }

  for (const manifestFile of manifestFiles.values()) {
    if (!bundleFiles.has(normalizeBundlePath(manifestFile.path))) {
      throw new Error(
        `Domain pack bundle is missing manifest file: ${manifestFile.path}`
      );
    }
  }

  const destinationFiles = [...bundleFiles.values()].map((file) => ({
    file,
    path: resolveBundleOutputPath(outputDir, file.path)
  }));
  const manifestPath = resolveBundleOutputPath(outputDir, "runstead-manifest.json");

  if (options.force !== true) {
    for (const destination of [
      ...destinationFiles.map((item) => item.path),
      manifestPath
    ]) {
      if (await exists(destination)) {
        throw new Error(`Refusing to overwrite existing file: ${destination}`);
      }
    }
  }

  for (const destination of destinationFiles) {
    await mkdir(dirname(destination.path), { recursive: true });
    await writeFile(
      destination.path,
      Buffer.from(destination.file.contentsBase64, "base64")
    );
  }

  await mkdir(dirname(manifestPath), { recursive: true });
  await writeFile(
    manifestPath,
    `${JSON.stringify(bundle.manifest, null, 2)}\n`,
    "utf8"
  );
  await assertExtractedBundleValid(outputDir);

  return {
    outputDir,
    manifestPath,
    files: destinationFiles.map((destination) => destination.file.path)
  };
}

async function assertExtractedBundleValid(outputDir: string): Promise<void> {
  const validation = await validateDomainPackDir(outputDir);

  if (!validation.valid) {
    throw new Error(
      `Extracted domain pack bundle is invalid: ${validation.issues
        .filter((issue) => issue.severity === "error")
        .map((issue) => issue.code)
        .join(", ")}`
    );
  }

  const verification = await verifyDomainPackManifest(outputDir);

  if (!verification.valid) {
    throw new Error(
      `Extracted domain pack manifest verification failed: ${verification.issues
        .map((issue) => issue.code)
        .join(", ")}`
    );
  }
}

function assertMatchingBundleFile(
  file: DomainPackBundleArtifactFile,
  expected: DomainPackManifestFile
): void {
  const contents = Buffer.from(file.contentsBase64, "base64");
  const sha256 = createHash("sha256").update(contents).digest("hex");

  if (file.bytes !== expected.bytes || contents.byteLength !== expected.bytes) {
    throw new Error(`Domain pack bundle file size mismatch: ${file.path}`);
  }

  if (file.sha256 !== expected.sha256 || sha256 !== expected.sha256) {
    throw new Error(`Domain pack bundle file hash mismatch: ${file.path}`);
  }
}

function normalizeBundlePath(path: string): string {
  const normalized = path.replaceAll("\\", "/");

  if (
    normalized.length === 0 ||
    isAbsolute(normalized) ||
    normalized
      .split("/")
      .some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new Error(`Domain pack bundle path escapes the package: ${path}`);
  }

  return normalized;
}

function resolveBundleOutputPath(outputDir: string, path: string): string {
  const normalizedPath = normalizeBundlePath(path);
  const destination = resolve(outputDir, normalizedPath);
  const relativePath = relative(outputDir, destination);

  if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error(`Domain pack bundle path escapes the output directory: ${path}`);
  }

  return destination;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}
