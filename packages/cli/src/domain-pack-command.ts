import { join } from "node:path";

import {
  buildDomainPackManifest,
  assessDomainPackMaturity,
  domainPackRegistryEntryToWorkPack,
  resolveDomainPackRef,
  validateDomainPackDir,
  type DomainPackManifest,
  type DomainPackMaturityResult,
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
  maturity: DomainPackMaturityResult;
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
  const [validation, manifest, maturity] = await Promise.all([
    validateDomainPackDir(entry.root),
    buildDomainPackManifest(entry.root),
    assessDomainPackMaturity(entry.root)
  ]);

  return {
    entry,
    validation,
    manifest,
    maturity
  };
}

export function formatDomainPackShowResult(result: ShowDomainPackResult): string {
  const domain = result.entry.domain;
  const workPack = domainPackRegistryEntryToWorkPack(result.entry);

  return [
    `Domain pack: ${domain.id}`,
    `Work pack: ${workPack.id}`,
    `Name: ${domain.name}`,
    `Version: ${domain.version}`,
    `Source: ${result.entry.source}`,
    `Root: ${result.entry.root}`,
    `Runstead min version: ${domain.compatibility.runsteadMinVersion}`,
    `Goal templates: ${formatCountedList(domain.goalTemplates)}`,
    `Task types: ${formatCountedList(domain.taskTypes)}`,
    `Fixtures: ${formatCountedList(result.validation.fixtures.map((fixture) => fixture.id))}`,
    `Evals: ${formatCountedList(result.validation.evals.map((evaluation) => evaluation.id))}`,
    `Repo templates: ${formatCountedList(domain.repoTemplates?.map((template) => template.id) ?? [])}`,
    `Gate thresholds: ${formatCountedList(Object.keys(domain.gateThresholds ?? {}))}`,
    `Report sections: ${formatCountedList(domain.reportSections?.map((section) => section.id) ?? [])}`,
    `Workflows: ${formatCountedList(workPack.workflows.map((workflow) => `${workflow.id}:${workflow.kind}`))}`,
    `Work pack components: ${formatCountedList([
      `${workPack.domain.id}:${workPack.domain.kind}`,
      ...workPack.extensions.map((component) => `${component.id}:${component.kind}`),
      ...workPack.skills.map((component) => `${component.id}:${component.kind}`)
    ])}`,
    `Capability reads: ${formatCountedList(domain.capabilityPolicy?.reads ?? [])}`,
    `Capability writes: ${formatCountedList(domain.capabilityPolicy?.writes ?? [])}`,
    `Capability approvals: ${formatCountedList(domain.capabilityPolicy?.approvalsRequired ?? [])}`,
    `Capability denied: ${formatCountedList(domain.capabilityPolicy?.denied ?? [])}`,
    `Migrations: ${formatCountedList(domain.migrations?.map((migration) => `${migration.fromVersion}->${migration.toVersion}`) ?? [])}`,
    `Required tools: ${formatCountedList(domain.requiredTools)}`,
    `Supported workers: ${formatCountedList(domain.supportedWorkers)}`,
    `Manifest files: ${result.manifest.files.length}`,
    `Validation: ${result.validation.valid ? "valid" : "invalid"}`,
    `Maturity: ${result.maturity.passed ? "passed" : "needs work"} (${Math.round(result.maturity.score * 100)}%)`
  ].join("\n");
}

function formatCountedList(values: string[]): string {
  if (values.length === 0) {
    return "0";
  }

  return `${values.length} (${values.join(", ")})`;
}
