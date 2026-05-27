import { parse as parseYaml } from "yaml";
import { normalizeRuntimeStartupUiSmokeConfig } from "@runstead/runtime";

import type { StartupReadyUiSmokeConfig } from "./startup-ready-ui-smoke-config.js";

export function parseStartupReadyUiSmokeConfig(
  contents: string,
  path: string
): {
  config: StartupReadyUiSmokeConfig;
  warnings: string[];
  repairHints: string[];
} {
  const parsed = parseYaml(contents) as unknown;

  return normalizeRuntimeStartupUiSmokeConfig(parsed, path);
}
