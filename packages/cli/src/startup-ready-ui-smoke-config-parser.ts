import { parse as parseYaml } from "yaml";

import type {
  StartupReadyUiSmokeCheckConfig,
  StartupReadyUiSmokeConfig
} from "./startup-ready-ui-smoke-config.js";
import type { StartupUiFlowAction } from "./startup-ui-validation-types.js";

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

function parseStartupReadyUiSmokeSteps(value: unknown): StartupUiFlowAction[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item, index) => parseStartupReadyUiSmokeStep(item, index));
}

function parseStartupReadyUiSmokeStep(
  value: unknown,
  index: number
): StartupUiFlowAction {
  if (!isRecord(value)) {
    throw new Error(`UI smoke flow step ${index + 1} must be an object`);
  }

  const type = stringValue(value.type);
  const normalized =
    type === undefined && Object.keys(value).length === 1
      ? keyedFlowAction(value)
      : value;
  const normalizedType = stringValue(normalized.type);

  switch (normalizedType) {
    case "fill":
      return {
        type: "fill",
        ...flowSelectors(normalized),
        value: requiredStringValue(normalized.value, `UI smoke fill ${index + 1}`)
      };
    case "select":
      return {
        type: "select",
        ...flowSelectors(normalized),
        value: requiredStringValue(normalized.value, `UI smoke select ${index + 1}`)
      };
    case "click":
      return {
        type: "click",
        ...flowSelectors(normalized)
      };
    case "expectText":
      return {
        type: "expectText",
        text: requiredStringValue(
          normalized.text ?? normalized.value,
          `UI smoke expectText ${index + 1}`
        )
      };
    case "expectCount":
      return {
        type: "expectCount",
        selector: requiredStringValue(
          normalized.selector,
          `UI smoke expectCount selector ${index + 1}`
        ),
        count: requiredNumberValue(
          normalized.count,
          `UI smoke expectCount count ${index + 1}`
        )
      };
    case "reload":
      return {
        type: "reload"
      };
    case "expectPersisted":
      return {
        type: "expectPersisted",
        text: requiredStringValue(
          normalized.text ?? normalized.value,
          `UI smoke expectPersisted ${index + 1}`
        ),
        ...flowSelectors(normalized)
      };
    case "expectNoOverlap":
      return {
        type: "expectNoOverlap",
        selectors: requiredSelectorList(
          normalized,
          `UI smoke expectNoOverlap selectors ${index + 1}`
        )
      };
    default:
      throw new Error(
        `Unsupported UI smoke flow step ${index + 1}: ${String(normalizedType)}`
      );
  }
}

function keyedFlowAction(value: Record<string, unknown>): Record<string, unknown> {
  const [type, payload] = Object.entries(value)[0] ?? [];

  return isRecord(payload) ? { type, ...payload } : { type, value: payload };
}

function flowSelectors(value: Record<string, unknown>): {
  selector?: string;
  selectors?: string[];
} {
  return {
    ...(typeof value.selector === "string" ? { selector: value.selector } : {}),
    ...(!Array.isArray(value.selectors)
      ? {}
      : { selectors: arrayOfStrings(value.selectors) })
  };
}

function requiredSelectorList(value: Record<string, unknown>, label: string): string[] {
  const selectors = unique([
    ...arrayOfStrings(value.selectors),
    ...(typeof value.selector === "string" ? [value.selector] : [])
  ]);

  if (selectors.length === 0) {
    throw new Error(`${label} must include at least one selector`);
  }

  return selectors;
}

function requiredStringValue(value: unknown, label: string): string {
  const parsed = stringValue(value);

  if (parsed === undefined) {
    throw new Error(`${label} must be a non-empty string`);
  }

  return parsed;
}

function requiredNumberValue(value: unknown, label: string): number {
  const parsed = numberValue(value);

  if (parsed === undefined) {
    throw new Error(`${label} must be a number`);
  }

  return parsed;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();

  return trimmed.length === 0 ? undefined : trimmed;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }

  return value;
}

function arrayOfStrings(value: unknown): string[] {
  if (typeof value === "string") {
    const trimmed = value.trim();

    return trimmed.length === 0 ? [] : [trimmed];
  }

  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
