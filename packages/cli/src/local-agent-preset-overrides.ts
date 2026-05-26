import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";

import { parse as parseYaml } from "yaml";

import { resolveRunsteadRoot } from "./runstead-root.js";
import type { CommandVerifierInput } from "./verifier-evidence.js";

export interface LocalAgentPresetOverride {
  model?: string;
  maxTurns?: number;
  maxToolCalls?: number;
  maxFailedToolCalls?: number;
  verifierCommands?: CommandVerifierInput[];
  promptFocus?: string;
}

export async function loadLocalAgentPresetOverrides(options: {
  cwd?: string;
}): Promise<Record<string, LocalAgentPresetOverride>> {
  const resolved = await resolveRunsteadRoot(options.cwd);

  if (resolved.source === "missing") {
    return {};
  }

  const path = join(resolved.root, "agent-presets.yaml");

  try {
    await access(path, constants.R_OK);
  } catch {
    return {};
  }

  const parsed = parseYaml(await readFile(path, "utf8")) as unknown;

  if (!isRecord(parsed)) {
    throw new Error(`Agent presets config must be a YAML object: ${path}`);
  }

  const presets = isRecord(parsed.presets) ? parsed.presets : parsed;

  return Object.fromEntries(
    Object.entries(presets).map(([id, value]) => [id, parsePresetOverride(id, value)])
  );
}

export function mergePromptFocus(
  configured: string | undefined,
  prompt: string | undefined
): string | undefined {
  const parts = [configured, prompt]
    .map((part) => part?.trim())
    .filter((part): part is string => part !== undefined && part.length > 0);

  return parts.length === 0 ? undefined : parts.join("\n");
}

function parsePresetOverride(id: string, value: unknown): LocalAgentPresetOverride {
  if (!isRecord(value)) {
    throw new Error(`Agent preset override ${id} must be an object`);
  }

  return {
    ...optionalString(value, "model"),
    ...optionalPositiveInteger(value, "maxTurns", "max_turns"),
    ...optionalPositiveInteger(value, "maxToolCalls", "max_tool_calls"),
    ...optionalPositiveInteger(value, "maxFailedToolCalls", "max_failed_tool_calls"),
    ...optionalString(value, "promptFocus", "prompt_focus"),
    ...optionalVerifierCommands(value.verifier)
  };
}

function optionalString(
  record: Record<string, unknown>,
  field: keyof LocalAgentPresetOverride,
  yamlField = String(field)
): Partial<LocalAgentPresetOverride> {
  const value = record[yamlField];

  return typeof value === "string" && value.trim().length > 0
    ? { [field]: value.trim() }
    : {};
}

function optionalPositiveInteger(
  record: Record<string, unknown>,
  field: keyof LocalAgentPresetOverride,
  yamlField: string
): Partial<LocalAgentPresetOverride> {
  const value = record[yamlField];

  if (value === undefined) {
    return {};
  }

  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Agent preset override ${yamlField} must be a positive integer`);
  }

  return { [field]: value };
}

function optionalVerifierCommands(value: unknown): Partial<LocalAgentPresetOverride> {
  if (value === undefined) {
    return {};
  }

  if (!isRecord(value)) {
    throw new Error("Agent preset override verifier must be an object");
  }

  return {
    verifierCommands: Object.entries(value).map(([name, command]) => {
      if (typeof command !== "string" || command.trim().length === 0) {
        throw new Error(`Agent preset override verifier ${name} must be a command`);
      }

      return {
        name,
        command: command.trim()
      };
    })
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
