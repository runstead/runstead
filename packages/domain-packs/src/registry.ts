import { constants } from "node:fs";
import { access, readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

import type { DomainPack } from "./domain-pack.js";
import { getAiNativeStartupPackDir } from "./ai-native-startup.js";
import { getEmailFollowupPackDir } from "./email-followup.js";
import { getResearchMonitorPackDir } from "./research-monitor.js";
import { getRepoMaintenancePackDir } from "./repo-maintenance.js";
import { validateDomainPackDir } from "./validator.js";

export type DomainPackRegistrySource = "built_in" | "workspace" | "path";

export interface DomainPackRegistryEntry {
  id: string;
  root: string;
  source: DomainPackRegistrySource;
  domain: DomainPack;
}

export interface DomainPackRegistryIssue {
  root: string;
  severity: "error" | "warning";
  code: string;
  message: string;
}

export interface ListDomainPacksOptions {
  roots?: string[];
  includeBuiltIns?: boolean;
}

export interface ListDomainPacksResult {
  entries: DomainPackRegistryEntry[];
  issues: DomainPackRegistryIssue[];
}

export type ResolveDomainPackOptions = ListDomainPacksOptions;

const BUILT_IN_DOMAIN_PACK_ROOTS = [
  getAiNativeStartupPackDir(),
  getRepoMaintenancePackDir(),
  getResearchMonitorPackDir(),
  getEmailFollowupPackDir()
];

export async function listDomainPacks(
  options: ListDomainPacksOptions = {}
): Promise<ListDomainPacksResult> {
  const includeBuiltIns = options.includeBuiltIns ?? true;
  const issues: DomainPackRegistryIssue[] = [];
  const entries: DomainPackRegistryEntry[] = [];

  if (includeBuiltIns) {
    for (const root of BUILT_IN_DOMAIN_PACK_ROOTS) {
      const entry = await loadRegistryEntry({
        root,
        source: "built_in",
        issues
      });

      if (entry !== undefined) {
        entries.push(entry);
      }
    }
  }

  for (const root of options.roots ?? []) {
    const discovered = await discoverRegistryEntries(resolve(root), issues);
    entries.push(...discovered);
  }

  const dedupedEntries = dedupeEntries(entries);
  collectDuplicatePackIds(dedupedEntries, issues);

  return {
    entries: dedupedEntries,
    issues
  };
}

export async function resolveDomainPackRef(
  ref: string,
  options: ResolveDomainPackOptions = {}
): Promise<DomainPackRegistryEntry> {
  if (looksLikePath(ref)) {
    const entry = await loadRegistryEntry({
      root: resolve(ref),
      source: "path",
      issues: []
    });

    if (entry === undefined) {
      throw new Error(`Domain pack path is invalid: ${ref}`);
    }

    return entry;
  }

  const registry = await listDomainPacks(options);
  const matches = registry.entries.filter((entry) => entry.id === ref);

  if (matches.length === 0) {
    throw new Error(`Domain pack not found: ${ref}`);
  }

  if (matches.length > 1) {
    throw new Error(`Domain pack reference is ambiguous: ${ref}`);
  }

  return matches[0]!;
}

async function discoverRegistryEntries(
  root: string,
  issues: DomainPackRegistryIssue[]
): Promise<DomainPackRegistryEntry[]> {
  if (await hasDomainYaml(root)) {
    const entry = await loadRegistryEntry({
      root,
      source: "workspace",
      issues
    });

    return entry === undefined ? [] : [entry];
  }

  if (!(await directoryExists(root))) {
    issues.push({
      root,
      severity: "warning",
      code: "registry_root_missing",
      message: "Domain pack registry root does not exist"
    });
    return [];
  }

  const entries = await readdir(root, { withFileTypes: true });
  const discovered: DomainPackRegistryEntry[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const pack = await loadRegistryEntry({
      root: join(root, entry.name),
      source: "workspace",
      issues
    });

    if (pack !== undefined) {
      discovered.push(pack);
    }
  }

  return discovered;
}

async function loadRegistryEntry(input: {
  root: string;
  source: DomainPackRegistrySource;
  issues: DomainPackRegistryIssue[];
}): Promise<DomainPackRegistryEntry | undefined> {
  const root = resolve(input.root);
  const validation = await validateDomainPackDir(root);

  for (const issue of validation.issues) {
    input.issues.push({
      root: issue.path ?? root,
      severity: issue.severity,
      code: issue.code,
      message: issue.message
    });
  }

  if (!validation.valid || validation.domain === undefined) {
    if (validation.issues.length === 0) {
      input.issues.push({
        root,
        severity: "error",
        code: "domain_pack_invalid",
        message: "Domain pack validation failed"
      });
    }

    return undefined;
  }

  return {
    id: validation.domain.id,
    root,
    source: input.source,
    domain: validation.domain
  };
}

function dedupeEntries(entries: DomainPackRegistryEntry[]): DomainPackRegistryEntry[] {
  const seen = new Map<string, DomainPackRegistryEntry>();

  for (const entry of entries) {
    const key = `${entry.id}:${entry.root}`;
    seen.set(key, entry);
  }

  return [...seen.values()].sort((left, right) =>
    `${left.id}:${left.root}`.localeCompare(`${right.id}:${right.root}`)
  );
}

function collectDuplicatePackIds(
  entries: DomainPackRegistryEntry[],
  issues: DomainPackRegistryIssue[]
): void {
  const entriesById = new Map<string, DomainPackRegistryEntry[]>();

  for (const entry of entries) {
    entriesById.set(entry.id, [...(entriesById.get(entry.id) ?? []), entry]);
  }

  for (const [id, matches] of entriesById) {
    if (matches.length < 2) {
      continue;
    }

    issues.push({
      root: matches.map((entry) => entry.root).join(", "),
      severity: "error",
      code: "domain_pack_duplicate_id",
      message: `Duplicate domain pack id found in registry: ${id}`
    });
  }
}

async function hasDomainYaml(root: string): Promise<boolean> {
  return fileExists(join(root, "domain.yaml"));
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function directoryExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

function looksLikePath(ref: string): boolean {
  return (
    ref.startsWith(".") ||
    ref.startsWith("/") ||
    ref.includes("/") ||
    ref.includes("\\")
  );
}
