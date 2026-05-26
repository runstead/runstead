import { parse as parseYaml } from "yaml";

import type {
  StartupReadyUiSmokeCheckConfig,
  StartupReadyUiSmokeConfig
} from "./startup-ready-ui-smoke-config.js";
import {
  arrayOfStrings,
  isRecord,
  numberValue,
  stringValue,
  unique
} from "./startup-ready-ui-smoke-config-values.js";
import { parseStartupReadyUiSmokeSteps } from "./startup-ready-ui-smoke-flow-parser.js";

export function parseStartupReadyUiSmokeConfig(
  contents: string,
  path: string
): {
  config: StartupReadyUiSmokeConfig;
  warnings: string[];
  repairHints: string[];
} {
  const parsed = parseYaml(contents) as unknown;

  if (!isRecord(parsed)) {
    throw new Error(`UI smoke config must be a YAML object: ${path}`);
  }

  const warnings: string[] = [];
  const repairHints: string[] = [];
  const server = startupReadyUiSmokeServerObject(parsed);
  const checks = Array.isArray(parsed.checks) ? parsed.checks : [];
  const usesLegacyStartupShape = isRecord(parsed.startup);
  const usesLegacyCheckShape = checks.some(
    (check) => isRecord(check) && (isRecord(check.request) || isRecord(check.expect))
  );

  if (usesLegacyStartupShape || usesLegacyCheckShape) {
    warnings.push("legacy UI smoke config shape was auto-normalized");
    repairHints.push(
      "Prefer schemaVersion/server.command/server.port/checks[].expectText for durable UI smoke configs."
    );
  }

  if (server === undefined) {
    throw new Error(`UI smoke config is missing server settings: ${path}`);
  }

  const command = stringValue(server.command);
  const url = stringValue(server.url);
  const port = numberValue(server.port) ?? portFromUrl(url);
  const timeoutMs = numberValue(server.timeoutMs);

  if (command === undefined || port === undefined) {
    throw new Error(
      `UI smoke config server.command and server.port are required: ${path}`
    );
  }

  if (checks.length === 0) {
    throw new Error(`UI smoke config requires at least one check: ${path}`);
  }

  return {
    config: {
      schemaVersion: 1,
      server: {
        command,
        port,
        ...(url === undefined ? {} : { url }),
        ...(timeoutMs === undefined ? {} : { timeoutMs })
      },
      checks: checks.flatMap((check, index) =>
        parseStartupReadyUiSmokeCheck(check, index, path)
      )
    },
    warnings,
    repairHints
  };
}

function startupReadyUiSmokeServerObject(
  parsed: Record<string, unknown>
): Record<string, unknown> | undefined {
  if (isRecord(parsed.server)) {
    return parsed.server;
  }

  const startup = isRecord(parsed.startup) ? parsed.startup : undefined;

  if (startup === undefined) {
    return undefined;
  }

  const readyWhen = isRecord(startup.readyWhen) ? startup.readyWhen : undefined;

  return {
    command: startup.run,
    url: readyWhen?.url,
    port: readyWhen?.port,
    timeoutMs: startup.timeoutMs ?? readyWhen?.timeoutMs
  };
}

function parseStartupReadyUiSmokeCheck(
  input: unknown,
  index: number,
  path: string
): StartupReadyUiSmokeCheckConfig[] {
  if (!isRecord(input)) {
    throw new Error(`UI smoke check ${index + 1} must be an object: ${path}`);
  }

  const name = stringValue(input.name) ?? `check-${index + 1}`;
  const legacyRequest = isRecord(input.request) ? input.request : undefined;
  const legacyExpect = isRecord(input.expect) ? input.expect : undefined;
  const expectText = [
    ...arrayOfStrings(input.expectText),
    ...arrayOfStrings(input.expect),
    ...arrayOfStrings(legacyExpect?.bodyContains),
    ...arrayOfStrings(legacyExpect?.expectText),
    ...arrayOfStrings(legacyExpect?.text)
  ];
  const url = stringValue(input.url) ?? stringValue(legacyRequest?.url);
  const viewport = stringValue(input.viewport);
  const viewports = unique([
    ...(viewport === undefined ? [] : [viewport]),
    ...arrayOfStrings(input.viewports)
  ]);
  const parsedFlowSteps = parseStartupReadyUiSmokeSteps(input.steps ?? input.flow);
  const flow =
    typeof input.flow === "string"
      ? input.flow
      : (stringValue(input.description) ??
        (parsedFlowSteps.length === 0
          ? undefined
          : "configured UI smoke interaction flow"));
  const timeoutMs = numberValue(input.timeoutMs);

  const base = {
    name,
    ...(url === undefined ? {} : { url }),
    expectText,
    ...(flow === undefined ? {} : { flow }),
    ...(parsedFlowSteps.length === 0 ? {} : { steps: parsedFlowSteps }),
    ...(timeoutMs === undefined ? {} : { timeoutMs })
  };

  if (viewports.length === 0) {
    return [base];
  }

  return viewports.map((item) => ({
    ...base,
    name: viewports.length === 1 ? name : `${name}-${uiSmokeViewportSlug(item)}`,
    viewport: item
  }));
}

function uiSmokeViewportSlug(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "");

  return slug.length === 0 ? "viewport" : slug;
}

function portFromUrl(url: string | undefined): number | undefined {
  if (url === undefined) {
    return undefined;
  }

  try {
    const parsed = new URL(url);

    if (parsed.port.length > 0) {
      return Number(parsed.port);
    }

    if (parsed.protocol === "http:") {
      return 80;
    }

    if (parsed.protocol === "https:") {
      return 443;
    }

    return undefined;
  } catch {
    return undefined;
  }
}
