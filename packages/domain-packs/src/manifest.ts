import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
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
  defaultPolicy: string;
  goalTemplates: string[];
  taskTypes: string[];
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
  const files = await Promise.all([
    manifestFile(root, "domain.yaml"),
    manifestFile(root, domain.defaultPolicy),
    ...domain.goalTemplates.map((id) =>
      manifestFile(root, join("goal-templates", `${id}.yaml`))
    ),
    ...domain.taskTypes.map((id) =>
      manifestFile(root, join("task-types", `${id}.yaml`))
    )
  ]);

  return {
    schemaVersion: 1,
    domain: {
      id: domain.id,
      version: domain.version,
      name: domain.name
    },
    defaultPolicy: domain.defaultPolicy,
    goalTemplates: [...domain.goalTemplates],
    taskTypes: [...domain.taskTypes],
    requiredTools: [...domain.requiredTools],
    supportedWorkers: [...domain.supportedWorkers],
    files: files.sort((left, right) => left.path.localeCompare(right.path))
  };
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
