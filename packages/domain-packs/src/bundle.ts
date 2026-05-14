import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

import { z } from "zod";

import {
  buildDomainPackManifest,
  type DomainPackManifest,
  type DomainPackManifestFile
} from "./manifest.js";

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
      name: z.string().min(1)
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

  return {
    outputDir,
    manifestPath,
    files: destinationFiles.map((destination) => destination.file.path)
  };
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
