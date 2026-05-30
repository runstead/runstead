import { createHash } from "node:crypto";
import { lstat, readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";

import { z } from "zod";

import type { DomainPack } from "./domain-pack.js";
import { validateDomainPackDir } from "./validator.js";

export interface DomainPackManifestFile {
  path: string;
  bytes: number;
  sha256: string;
}

export interface DomainPackManifest {
  schemaVersion: 1;
  domain: Pick<DomainPack, "id" | "version" | "name" | "schemaVersion">;
  compatibility: DomainPack["compatibility"];
  defaultPolicy: string;
  goalTemplates: string[];
  taskTypes: string[];
  fixtures: string[];
  evals: string[];
  requiredTools: string[];
  supportedWorkers: string[];
  migrations: NonNullable<DomainPack["migrations"]>;
  repoTemplates: NonNullable<DomainPack["repoTemplates"]>;
  gateThresholds: NonNullable<DomainPack["gateThresholds"]>;
  reportSections: NonNullable<DomainPack["reportSections"]>;
  capabilityPolicy?: DomainPack["capabilityPolicy"];
  evalQuality?: DomainPack["evalQuality"];
  files: DomainPackManifestFile[];
}

export interface DomainPackManifestVerificationIssue {
  code: string;
  message: string;
  path?: string;
  expected?: string | number;
  actual?: string | number;
}

export interface DomainPackManifestVerificationResult {
  root: string;
  manifestPath: string;
  valid: boolean;
  issues: DomainPackManifestVerificationIssue[];
  manifest?: DomainPackManifest;
  current?: DomainPackManifest;
}

const DomainPackManifestFileSchema = z.object({
  path: z.string().min(1),
  bytes: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/)
});

const DomainPackManifestSchema = z.object({
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
  evalQuality: z
    .object({
      minimumScore: z.number().min(0).max(1),
      requiredContracts: z.array(z.string().min(1))
    })
    .optional(),
  files: z.array(DomainPackManifestFileSchema)
});

export async function buildDomainPackManifest(
  root: string
): Promise<DomainPackManifest> {
  const validation = await validateDomainPackDir(root);

  if (!validation.valid || validation.domain === undefined) {
    const reasons = validation.issues
      .filter((issue) => issue.severity === "error")
      .map((issue) => issue.code)
      .join(", ");

    throw new Error(`Cannot build manifest for invalid domain pack: ${reasons}`);
  }

  const domain = validation.domain;
  const files = await manifestFiles(root, [
    "domain.yaml",
    domain.defaultPolicy,
    ...domain.goalTemplates.map((id) => join("goal-templates", `${id}.yaml`)),
    ...domain.taskTypes.map((id) => join("task-types", `${id}.yaml`)),
    ...(validation.fixtures.length === 0 ? [] : ["fixtures/manifest.yaml"]),
    ...validation.fixtures.map((fixture) => join("fixtures", fixture.path)),
    ...(validation.evals.length === 0 ? [] : ["evals/benchmark.yaml"])
  ]);

  return {
    schemaVersion: 1,
    domain: {
      id: domain.id,
      version: domain.version,
      name: domain.name,
      ...(domain.schemaVersion === undefined
        ? {}
        : { schemaVersion: domain.schemaVersion })
    },
    compatibility: domain.compatibility,
    defaultPolicy: domain.defaultPolicy,
    goalTemplates: [...domain.goalTemplates],
    taskTypes: [...domain.taskTypes],
    fixtures: validation.fixtures.map((fixture) => fixture.id),
    evals: validation.evals.map((evaluation) => evaluation.id),
    requiredTools: [...domain.requiredTools],
    supportedWorkers: [...domain.supportedWorkers],
    migrations: domain.migrations ?? [],
    repoTemplates: domain.repoTemplates ?? [],
    gateThresholds: domain.gateThresholds ?? {},
    reportSections: domain.reportSections ?? [],
    ...(domain.capabilityPolicy === undefined
      ? {}
      : { capabilityPolicy: domain.capabilityPolicy }),
    ...(domain.evalQuality === undefined ? {} : { evalQuality: domain.evalQuality }),
    files: files.sort((left, right) => left.path.localeCompare(right.path))
  };
}

export async function verifyDomainPackManifest(
  root: string,
  manifestFile = "runstead-manifest.json"
): Promise<DomainPackManifestVerificationResult> {
  const manifestPath = join(root, manifestFile);
  const issues: DomainPackManifestVerificationIssue[] = [];
  let manifest: DomainPackManifest | undefined;
  let current: DomainPackManifest | undefined;

  try {
    manifest = parseDomainPackManifest(
      JSON.parse(await readFile(manifestPath, "utf8"))
    );
  } catch (error) {
    issues.push({
      code: "manifest_read_failed",
      message: error instanceof Error ? error.message : "Manifest could not be read",
      path: manifestPath
    });
  }

  try {
    current = await buildDomainPackManifest(root);
  } catch (error) {
    issues.push({
      code: "manifest_current_invalid",
      message:
        error instanceof Error
          ? error.message
          : "Current domain pack manifest could not be built"
    });
  }

  if (manifest !== undefined && current !== undefined) {
    collectManifestDrift(manifest, current, issues);
  }

  return {
    root,
    manifestPath,
    valid: issues.length === 0,
    issues,
    ...(manifest === undefined ? {} : { manifest }),
    ...(current === undefined ? {} : { current })
  };
}

export function formatDomainPackManifestVerificationResult(
  result: DomainPackManifestVerificationResult
): string {
  return [
    "Runstead domain pack manifest verification",
    `Path: ${result.root}`,
    `Manifest: ${result.manifestPath}`,
    `Status: ${result.valid ? "valid" : "invalid"}`,
    ...(result.manifest === undefined
      ? []
      : [
          `Domain: ${result.manifest.domain.id}@${result.manifest.domain.version}`,
          `Files: ${result.manifest.files.length}`
        ]),
    ...result.issues.map(
      (issue) =>
        `  ERROR ${issue.code}: ${issue.message}${
          issue.path === undefined ? "" : ` (${issue.path})`
        }`
    )
  ].join("\n");
}

async function manifestFiles(
  root: string,
  relativePaths: string[]
): Promise<DomainPackManifestFile[]> {
  const filePaths = await collectManifestFilePaths(root, relativePaths);

  return Promise.all(filePaths.map((path) => manifestFile(root, path)));
}

async function collectManifestFilePaths(
  root: string,
  relativePaths: string[]
): Promise<string[]> {
  const seen = new Set<string>();
  const filePaths: string[] = [];

  for (const relativePath of relativePaths) {
    await collectManifestFilePath({
      root,
      relativePath,
      seen,
      filePaths
    });
  }

  return filePaths.sort();
}

async function collectManifestFilePath(input: {
  root: string;
  relativePath: string;
  seen: Set<string>;
  filePaths: string[];
}): Promise<void> {
  const normalizedPath = normalizeManifestPath(input.relativePath);

  if (input.seen.has(normalizedPath)) {
    return;
  }

  const fullPath = join(input.root, input.relativePath);
  const stats = await lstat(fullPath);

  if (stats.isSymbolicLink()) {
    throw new Error(`Domain pack manifest cannot include symlinks: ${normalizedPath}`);
  }

  if (stats.isDirectory()) {
    const entries = await readdir(fullPath, { withFileTypes: true });

    for (const entry of entries.sort((left, right) =>
      String(left.name).localeCompare(String(right.name))
    )) {
      await collectManifestFilePath({
        root: input.root,
        relativePath: join(input.relativePath, String(entry.name)),
        seen: input.seen,
        filePaths: input.filePaths
      });
    }

    return;
  }

  if (stats.isFile()) {
    input.seen.add(normalizedPath);
    input.filePaths.push(input.relativePath);
  }
}

async function manifestFile(
  root: string,
  relativePath: string
): Promise<DomainPackManifestFile> {
  const contents = await readFile(join(root, relativePath));

  return {
    path: normalizeManifestPath(relative(root, join(root, relativePath))),
    bytes: contents.byteLength,
    sha256: createHash("sha256").update(contents).digest("hex")
  };
}

function normalizeManifestPath(path: string): string {
  return path.split(sep).join("/");
}

function parseDomainPackManifest(input: unknown): DomainPackManifest {
  return DomainPackManifestSchema.parse(input);
}

function collectManifestDrift(
  manifest: DomainPackManifest,
  current: DomainPackManifest,
  issues: DomainPackManifestVerificationIssue[]
): void {
  if (
    JSON.stringify(manifestMetadata(manifest)) !==
    JSON.stringify(manifestMetadata(current))
  ) {
    issues.push({
      code: "manifest_metadata_mismatch",
      message: "Stored manifest metadata does not match the current domain pack"
    });
  }

  const expectedFiles = new Map(manifest.files.map((file) => [file.path, file]));
  const actualFiles = new Map(current.files.map((file) => [file.path, file]));

  for (const expected of manifest.files) {
    const actual = actualFiles.get(expected.path);

    if (actual === undefined) {
      issues.push({
        code: "manifest_file_missing",
        message: `Manifest file is missing from the current pack: ${expected.path}`,
        path: expected.path
      });
      continue;
    }

    if (actual.bytes !== expected.bytes) {
      issues.push({
        code: "manifest_file_size_mismatch",
        message: `Manifest file size changed: ${expected.path}`,
        path: expected.path,
        expected: expected.bytes,
        actual: actual.bytes
      });
    }

    if (actual.sha256 !== expected.sha256) {
      issues.push({
        code: "manifest_file_hash_mismatch",
        message: `Manifest file hash changed: ${expected.path}`,
        path: expected.path,
        expected: expected.sha256,
        actual: actual.sha256
      });
    }
  }

  for (const actual of current.files) {
    if (!expectedFiles.has(actual.path)) {
      issues.push({
        code: "manifest_file_untracked",
        message: `Current pack has a file not listed in the manifest: ${actual.path}`,
        path: actual.path
      });
    }
  }
}

function manifestMetadata(
  manifest: DomainPackManifest
): Omit<DomainPackManifest, "files"> {
  return {
    schemaVersion: manifest.schemaVersion,
    domain: manifest.domain,
    compatibility: manifest.compatibility,
    defaultPolicy: manifest.defaultPolicy,
    goalTemplates: manifest.goalTemplates,
    taskTypes: manifest.taskTypes,
    fixtures: manifest.fixtures,
    evals: manifest.evals,
    requiredTools: manifest.requiredTools,
    supportedWorkers: manifest.supportedWorkers,
    migrations: manifest.migrations,
    repoTemplates: manifest.repoTemplates,
    gateThresholds: manifest.gateThresholds,
    reportSections: manifest.reportSections,
    ...(manifest.evalQuality === undefined ? {} : { evalQuality: manifest.evalQuality })
  };
}
