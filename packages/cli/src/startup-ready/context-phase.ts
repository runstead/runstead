import { generateStartupContext } from "../startup-automation.js";
import type { StartupReadinessRun, StartupReadyOptions } from "./types.js";
import { hasPhase, unique, updatePhase } from "./shared.js";

export async function refreshStartupReadyCurrentContext(
  run: StartupReadinessRun,
  options: StartupReadyOptions
): Promise<void> {
  if (!hasPhase(run, "context")) {
    return;
  }

  const refreshed = await generateStartupContext({
    cwd: run.cwd,
    currentOnly: true,
    ...(options.now === undefined ? {} : { now: options.now })
  });
  const current = run.phases.find((phase) => phase.id === "context");
  const status = current?.status === "pending" ? "passed" : current?.status;

  updatePhase(run, "context", {
    ...(status === undefined ? {} : { status }),
    evidenceIds: unique([...(current?.evidenceIds ?? []), refreshed.evidenceId]),
    artifacts: unique([
      ...(current?.artifacts ?? []),
      ...refreshed.files,
      ...refreshed.structuredFiles
    ]),
    blockers: current?.status === "blocked" ? current.blockers : []
  });
}
