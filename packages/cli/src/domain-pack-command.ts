import { join } from "node:path";

import {
  buildDomainPackManifest,
  resolveDomainPackRef,
  validateDomainPackDir,
  type DomainPackManifest,
  type DomainPackRegistryEntry,
  type DomainPackValidationResult
} from "@runstead/domain-packs";

import { resolveRunsteadRootSync } from "./runstead-root.js";

export interface ShowDomainPackOptions {
  cwd?: string;
  roots?: string[];
  includeBuiltIns?: boolean;
}

export interface ShowDomainPackResult {
  entry: DomainPackRegistryEntry;
  validation: DomainPackValidationResult;
  manifest: DomainPackManifest;
}

export async function showDomainPack(
  ref: string,
  options: ShowDomainPackOptions = {}
): Promise<ShowDomainPackResult> {
  const roots = [...(options.roots ?? [])];

  if (options.cwd !== undefined) {
    roots.push(join(resolveRunsteadRootSync(options.cwd).root, "domains"));
  }

  const entry = await resolveDomainPackRef(ref, {
    roots,
    ...(options.includeBuiltIns === undefined
      ? {}
      : { includeBuiltIns: options.includeBuiltIns })
  });
  const [validation, manifest] = await Promise.all([
    validateDomainPackDir(entry.root),
    buildDomainPackManifest(entry.root)
  ]);

  return {
    entry,
    validation,
    manifest
  };
}

export function formatDomainPackShowResult(result: ShowDomainPackResult): string {
  const domain = result.entry.domain;

  return [
    `Domain pack: ${domain.id}`,
    `Name: ${domain.name}`,
    `Version: ${domain.version}`,
    `Source: ${result.entry.source}`,
    `Root: ${result.entry.root}`,
    `Runstead min version: ${domain.compatibility.runsteadMinVersion}`,
    `Goal templates: ${formatCountedList(domain.goalTemplates)}`,
    `Task types: ${formatCountedList(domain.taskTypes)}`,
    `Fixtures: ${formatCountedList(result.validation.fixtures.map((fixture) => fixture.id))}`,
    `Evals: ${formatCountedList(result.validation.evals.map((evaluation) => evaluation.id))}`,
    `Required tools: ${formatCountedList(domain.requiredTools)}`,
    `Supported workers: ${formatCountedList(domain.supportedWorkers)}`,
    `Manifest files: ${result.manifest.files.length}`,
    `Validation: ${result.validation.valid ? "valid" : "invalid"}`
  ].join("\n");
}

function formatCountedList(values: string[]): string {
  if (values.length === 0) {
    return "0";
  }

  return `${values.length} (${values.join(", ")})`;
}
