import { join } from "node:path";

import { stringify as stringifyYaml } from "yaml";

import type { StartupUiFlowAction } from "./startup-ui-validation-types.js";

export { parseStartupReadyUiSmokeConfig } from "./startup-ready-ui-smoke-config-parser.js";

export interface StartupReadyUiSmokeConfig {
  schemaVersion: 1;
  server: StartupReadyUiSmokeServerConfig;
  checks: StartupReadyUiSmokeCheckConfig[];
}

export interface StartupReadyUiSmokeServerConfig {
  command: string;
  port: number;
  url?: string;
  timeoutMs?: number;
}

export interface StartupReadyUiSmokeCheckConfig {
  name: string;
  url?: string;
  viewport?: string;
  expectText: string[];
  flow?: string;
  steps?: StartupUiFlowAction[];
  timeoutMs?: number;
}

export function stringifyStartupReadyUiSmokeConfig(
  config: StartupReadyUiSmokeConfig
): string {
  return stringifyYaml(config, { lineWidth: 0 });
}

export function startupReadyUiSmokePath(root: string): string {
  return join(root, "startup", "ui-smoke.yaml");
}
