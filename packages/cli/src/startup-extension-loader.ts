import type { Dirent } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";

import type { ReadinessEvidenceRequirement, ReadinessTarget } from "@runstead/runtime";
import {
  compileRunsteadExtensionRuntime,
  extensionCollectorPolicyBlockers,
  extensionReadinessEvidenceRequirements,
  extensionReadinessRequirementBlockers,
  type RunsteadExtensionRuntimeContract
} from "@runstead/sdk";
import { parse as parseYaml } from "yaml";

import { resolveRunsteadRoot } from "./runstead-root.js";

const EXTENSION_MANIFEST_EXTENSIONS = new Set([".json", ".yaml", ".yml"]);
const EXTENSION_DIRECTORY_MANIFESTS = [
  "runstead-extension.yaml",
  "runstead-extension.yml",
  "runstead-extension.json",
  "extension.yaml",
  "extension.yml",
  "extension.json"
];

export interface LoadedStartupReadinessExtension {
  path: string;
  contract: RunsteadExtensionRuntimeContract;
}

export interface LoadStartupReadinessExtensionsResult {
  root: string;
  discoveredPaths: string[];
  extensions: LoadedStartupReadinessExtension[];
  issues: string[];
}

export async function loadStartupReadinessExtensions(options: {
  cwd: string;
  domain?: string;
}): Promise<LoadStartupReadinessExtensionsResult> {
  const root = await resolveRunsteadRoot(options.cwd);
  const domain = options.domain ?? "ai-native-startup";

  if (root.source === "missing") {
    return {
      root: root.root,
      discoveredPaths: [],
      extensions: [],
      issues: []
    };
  }

  const discoveredPaths = await discoverExtensionManifestPaths(
    join(root.root, "extensions")
  );
  const extensions: LoadedStartupReadinessExtension[] = [];
  const issues: string[] = [];

  for (const path of discoveredPaths) {
    try {
      const manifest = parseExtensionManifest(await readFile(path, "utf8"), path);
      const contract = compileRunsteadExtensionRuntime(
        manifest as Parameters<typeof compileRunsteadExtensionRuntime>[0]
      );

      if (!contract.domains.includes(domain)) {
        continue;
      }

      extensions.push({ path, contract });
    } catch (error) {
      issues.push(`extension ${path} failed to load: ${errorMessage(error)}`);
    }
  }

  return {
    root: root.root,
    discoveredPaths,
    extensions,
    issues
  };
}

export function startupReadinessExtensionEvidenceRequirements(
  extensions: LoadedStartupReadinessExtension[],
  options: { stage?: string } = {}
): ReadinessEvidenceRequirement[] {
  return extensionReadinessEvidenceRequirements(
    extensions.map(({ contract }) => contract),
    options
  );
}

export function startupReadinessExtensionRequirementBlockers(input: {
  issues: string[];
  requirements: ReadinessEvidenceRequirement[];
  target: ReadinessTarget;
  evidenceTiers: string[];
  evidenceTypes: string[];
}): string[] {
  return extensionReadinessRequirementBlockers({
    issues: input.issues,
    requirements: input.requirements,
    target: input.target,
    evidenceTiers: input.evidenceTiers,
    evidenceTypes: input.evidenceTypes
  });
}

export function startupReadinessExtensionPolicyBlockers(input: {
  extensions: LoadedStartupReadinessExtension[];
  requirements: ReadinessEvidenceRequirement[];
  target: ReadinessTarget;
  worker: string;
  governanceProfile: string;
}): string[] {
  return extensionCollectorPolicyBlockers({
    contracts: input.extensions.map(({ contract }) => contract),
    requirements: input.requirements,
    target: input.target,
    worker: input.worker,
    governanceProfile: input.governanceProfile
  });
}

export async function startupReadinessExtensionVerifierCommands(options: {
  cwd: string;
}): Promise<{ name: string; command: string }[]> {
  const loaded = await loadStartupReadinessExtensions({ cwd: options.cwd });

  return loaded.extensions.flatMap(({ contract }) =>
    contract.verifiers.map((verifier) => ({
      name: `extension:${contract.extensionId}/${verifier.id}`,
      command: verifier.command
    }))
  );
}

async function discoverExtensionManifestPaths(root: string): Promise<string[]> {
  let entries: Dirent[];

  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }

  const paths: string[] = [];

  for (const entry of entries) {
    const path = join(root, entry.name);

    if (entry.isFile() && EXTENSION_MANIFEST_EXTENSIONS.has(extname(entry.name))) {
      paths.push(path);
      continue;
    }

    if (entry.isDirectory()) {
      paths.push(...(await discoverDirectoryManifestPaths(path)));
    }
  }

  return paths.sort();
}

async function discoverDirectoryManifestPaths(root: string): Promise<string[]> {
  const paths: string[] = [];
  let names: string[];

  try {
    names = await readdir(root);
  } catch {
    return [];
  }

  for (const name of EXTENSION_DIRECTORY_MANIFESTS) {
    const path = join(root, name);

    if (names.includes(name)) {
      paths.push(path);
    }
  }

  return paths;
}

function parseExtensionManifest(contents: string, path: string): unknown {
  if (extname(path) === ".json") {
    return JSON.parse(contents) as unknown;
  }

  return parseYaml(contents) as unknown;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
