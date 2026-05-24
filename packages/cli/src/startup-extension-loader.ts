import type { Dirent } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";

import type { ReadinessEvidenceRequirement, ReadinessTarget } from "@runstead/runtime";
import {
  compileRunsteadExtensionRuntime,
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
  return extensions.flatMap(({ contract }) =>
    contract.evidenceRequirements
      .filter((requirement) =>
        extensionRequirementAppliesToStage(contract, requirement, options.stage)
      )
      .map((requirement) => ({
        source: "extension",
        sourceId: `${contract.extensionId}/${requirement.sourceId}`,
        targets: [...requirement.targets],
        evidenceTiers: [...requirement.evidenceTiers],
        evidenceTypes: [...requirement.evidenceTypes],
        ...(requirement.blockers.length === 0
          ? {}
          : {
              blockers: requirement.blockers.map(
                (blocker) =>
                  `extension ${contract.extensionId}/${requirement.sourceId}: ${blocker}`
              )
            })
      }))
  );
}

export function startupReadinessExtensionRequirementBlockers(input: {
  issues: string[];
  requirements: ReadinessEvidenceRequirement[];
  target: ReadinessTarget;
  evidenceTiers: string[];
  evidenceTypes: string[];
}): string[] {
  const tiers = new Set(input.evidenceTiers);
  const types = new Set(input.evidenceTypes);
  const requirementBlockers = input.requirements.flatMap((requirement) => {
    if (!requirement.targets.includes(input.target)) {
      return [];
    }

    const missingTiers = requirement.evidenceTiers.filter((tier) => !tiers.has(tier));
    const missingTypes = requirement.evidenceTypes.filter((type) => !types.has(type));

    if (missingTiers.length === 0 && missingTypes.length === 0) {
      return [];
    }

    if ((requirement.blockers ?? []).length > 0) {
      return requirement.blockers ?? [];
    }

    return [
      ...missingTiers.map(
        (tier) =>
          `${requirement.source} ${requirement.sourceId} requires ${tier} evidence tier`
      ),
      ...missingTypes.map(
        (type) =>
          `${requirement.source} ${requirement.sourceId} requires ${type} evidence`
      )
    ];
  });

  return [...input.issues, ...requirementBlockers];
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

function extensionRequirementAppliesToStage(
  contract: RunsteadExtensionRuntimeContract,
  requirement: RunsteadExtensionRuntimeContract["evidenceRequirements"][number],
  stage: string | undefined
): boolean {
  if (stage === undefined || requirement.source === "verifier") {
    return true;
  }

  if (requirement.source === "gate") {
    return contract.gates.some(
      (gate) => gate.id === requirement.sourceId && gate.stage === stage
    );
  }

  const matchingGateFacetNames = new Set(
    contract.gates
      .filter((gate) => gate.stage === stage)
      .flatMap((gate) => gate.requiredFacets.map((facet) => facet.name))
  );

  return (
    matchingGateFacetNames.size === 0 ||
    matchingGateFacetNames.has(requirement.sourceId)
  );
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
