import { join } from "node:path";

import type {
  RuntimeStartupUiSmokeCheckConfig,
  RuntimeStartupUiSmokeConfig,
  RuntimeStartupUiSmokeServerConfig
} from "@runstead/runtime";
import { stringify as stringifyYaml } from "yaml";

export { parseStartupReadyUiSmokeConfig } from "./startup-ready-ui-smoke-config-parser.js";

export type StartupReadyUiSmokeConfig = RuntimeStartupUiSmokeConfig;
export type StartupReadyUiSmokeServerConfig = RuntimeStartupUiSmokeServerConfig;
export type StartupReadyUiSmokeCheckConfig = RuntimeStartupUiSmokeCheckConfig;

export function stringifyStartupReadyUiSmokeConfig(
  config: StartupReadyUiSmokeConfig
): string {
  return stringifyYaml(config, { lineWidth: 0 });
}

export function startupReadyUiSmokePath(root: string): string {
  return join(root, "startup", "ui-smoke.yaml");
}
