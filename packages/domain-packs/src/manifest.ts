import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";

import type { DomainPack } from "./domain-pack.js";
import { validateDomainPackDir } from "./validator.js";

export interface DomainPackManifestFile {
  path: string;
  bytes: number;
  sha256: string;
}

export interface DomainPackManifest {
  schemaVersion: 1;
  domain: Pick<DomainPack, "id" | "version" | "name">;
  compatibility: DomainPack["compatibility"];
  defaultPolicy: string;
  goalTemplates: string[];
  taskTypes: string[];
  fixtures: string[];
  evals: string[];
  requiredTools: string[];
  supportedWorkers: string[];
  files: DomainPackManifestFile[];
}

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
      name: domain.name
    },
    compatibility: domain.compatibility,
    defaultPolicy: domain.defaultPolicy,
    goalTemplates: [...domain.goalTemplates],
    taskTypes: [...domain.taskTypes],
    fixtures: validation.fixtures.map((fixture) => fixture.id),
    evals: validation.evals.map((evaluation) => evaluation.id),
    requiredTools: [...domain.requiredTools],
    supportedWorkers: [...domain.supportedWorkers],
    files: files.sort((left, right) => left.path.localeCompare(right.path))
  };
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
  const stats = await stat(fullPath);

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
