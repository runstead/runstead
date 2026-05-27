import type { StartupReadinessRun } from "./types.js";
import { startupReadyShellArg } from "./shared.js";

export function startupReadySourceConnectorBlocker(blocker: string): boolean {
  const lower = blocker.toLowerCase();

  return (
    lower.includes(" connector requires ") ||
    lower.includes("startup_source ") ||
    lower.includes("source connector")
  );
}

export function startupReadySourcePlanCommand(run: StartupReadinessRun): string {
  return `runstead startup source plan --cwd ${startupReadyShellArg(run.cwd)} --target ${run.target}`;
}
