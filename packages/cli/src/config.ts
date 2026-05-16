import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { requireRunsteadRoot } from "./runstead-root.js";

export interface RunsteadConfigFile {
  path: string;
  root: string;
  config: Record<string, unknown>;
}

export interface RunsteadConfigSetResult {
  path: string;
  key: string;
  value: string;
}

export const SUPPORTED_CONFIG_KEYS = [
  "codex.model",
  "model.provider",
  "model.name",
  "model.baseUrl",
  "model.apiKeyEnv"
] as const;

const SUPPORTED_CONFIG_KEY_SET = new Set<string>(SUPPORTED_CONFIG_KEYS);

export async function loadRunsteadConfig(
  options: {
    cwd?: string;
  } = {}
): Promise<RunsteadConfigFile> {
  const resolved = await requireRunsteadRoot(options.cwd);
  const path = join(resolved.root, "config.yaml");
  const parsed = parseYaml(await readFile(path, "utf8")) as unknown;

  if (!isRecord(parsed)) {
    throw new Error(`Runstead config must be a YAML object: ${path}`);
  }

  return {
    path,
    root: resolved.root,
    config: parsed
  };
}

export async function readRunsteadConfigValue(options: {
  cwd?: string;
  key: string;
}): Promise<string | undefined> {
  const loaded = await loadRunsteadConfig(options);
  const value = readConfigValue(loaded.config, options.key);

  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

export async function setRunsteadConfigValue(options: {
  cwd?: string;
  key: string;
  value: string;
}): Promise<RunsteadConfigSetResult> {
  assertSupportedConfigKey(options.key);

  const value = options.value.trim();

  if (value.length === 0) {
    throw new Error(`Config value for ${options.key} cannot be empty`);
  }

  const loaded = await loadRunsteadConfig(options);

  setConfigValue(loaded.config, options.key, value);
  await writeFile(loaded.path, stringifyYaml(loaded.config), "utf8");

  return {
    path: loaded.path,
    key: options.key,
    value
  };
}

export function formatRunsteadConfigSetResult(result: RunsteadConfigSetResult): string {
  return [`Set ${result.key}: ${result.value}`, `Config: ${result.path}`].join("\n");
}

function readConfigValue(config: Record<string, unknown>, key: string): unknown {
  assertSupportedConfigKey(key);

  let current: unknown = config;

  for (const part of key.split(".")) {
    if (!isRecord(current)) {
      return undefined;
    }

    current = current[part];
  }

  return current;
}

function setConfigValue(
  config: Record<string, unknown>,
  key: string,
  value: string
): void {
  const parts = key.split(".");
  let current = config;

  for (const part of parts.slice(0, -1)) {
    const next = current[part];

    if (!isRecord(next)) {
      current[part] = {};
    }

    current = current[part] as Record<string, unknown>;
  }

  const leaf = parts[parts.length - 1];

  if (leaf === undefined) {
    throw new Error("Config key cannot be empty");
  }

  current[leaf] = value;
}

function assertSupportedConfigKey(key: string): void {
  if (!SUPPORTED_CONFIG_KEY_SET.has(key)) {
    throw new Error(
      `Unsupported config key: ${key}. Supported keys: ${SUPPORTED_CONFIG_KEYS.join(", ")}`
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
