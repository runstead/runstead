import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import type {
  DashboardStartupGuidedStep,
  DashboardStartupOperatorCommand,
  DashboardStartupRun
} from "./dashboard-types.js";

export async function readStartupRuns(root: string): Promise<DashboardStartupRun[]> {
  const dirs = [join(root, "startup", "readiness-runs"), join(root, "startup", "runs")];

  return (
    await Promise.all(
      dirs.map(async (dir) => {
        try {
          return await Promise.all(
            (await readdir(dir))
              .filter((name) => name.endsWith(".json"))
              .map((name) => readStartupRunFile(join(dir, name)))
          );
        } catch {
          return [];
        }
      })
    )
  )
    .flat()
    .filter((run): run is DashboardStartupRun => run !== undefined)
    .sort((left, right) =>
      startupRunSortTime(right).localeCompare(startupRunSortTime(left))
    );
}

async function readStartupRunFile(
  path: string
): Promise<DashboardStartupRun | undefined> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;

    if (!isRecord(parsed)) {
      return undefined;
    }

    const phases = Array.isArray(parsed.phases) ? parsed.phases.filter(isRecord) : [];
    const guidedFlow = Array.isArray(parsed.guidedFlow)
      ? parsed.guidedFlow.filter(isRecord).map(rowToStartupGuidedStep)
      : [];
    const operatorCommands = Array.isArray(parsed.operatorCommands)
      ? parsed.operatorCommands.filter(isRecord).map(rowToStartupOperatorCommand)
      : [];
    const startedAt = stringField(parsed.startedAt);
    const completedAt = stringField(parsed.completedAt);

    return {
      id: stringField(parsed.id) ?? "unknown",
      stage: stringField(parsed.stage) ?? "unknown",
      target: stringField(parsed.target) ?? "unknown",
      status: stringField(parsed.status) ?? "unknown",
      verdict: stringField(parsed.verdict) ?? "not_evaluated",
      ...(startedAt === undefined ? {} : { startedAt }),
      ...(completedAt === undefined ? {} : { completedAt }),
      blockers: stringArrayField(parsed.verdictBlockers),
      reports: stringArrayField(parsed.reportPaths),
      guidedFlow,
      operatorCommands,
      uiSmokeArtifacts: phases
        .filter((phase) => stringField(phase.id) === "ui_smoke")
        .flatMap((phase) => stringArrayField(phase.artifacts)),
      timeline: phases.map((phase) => {
        const phaseId = stringField(phase.id) ?? "unknown";
        const nextAction = stringField(phase.nextAction);
        const evidenceIds = stringArrayField(phase.evidenceIds);

        return {
          phase: phaseId,
          title: stringField(phase.title) ?? phaseId,
          status: stringField(phase.status) ?? "unknown",
          evidence: evidenceIds.length,
          evidenceIds,
          artifacts: stringArrayField(phase.artifacts),
          blockers: stringArrayField(phase.blockers),
          ...(nextAction === undefined ? {} : { nextAction })
        };
      })
    };
  } catch {
    return undefined;
  }
}

function rowToStartupGuidedStep(
  row: Record<string, unknown>
): DashboardStartupGuidedStep {
  const id = stringField(row.id) ?? "unknown";

  return {
    id,
    title: stringField(row.title) ?? id,
    status: stringField(row.status) ?? "unknown",
    resolution: stringField(row.resolution) ?? "unknown",
    why: stringField(row.why) ?? "",
    nextAction: stringField(row.nextAction) ?? "",
    ...(stringField(row.command) === undefined
      ? {}
      : { command: stringField(row.command) ?? "" }),
    blockers: stringArrayField(row.blockers)
  };
}

function rowToStartupOperatorCommand(
  row: Record<string, unknown>
): DashboardStartupOperatorCommand {
  const kind = stringField(row.kind) ?? "unknown";

  return {
    kind,
    title: stringField(row.title) ?? kind,
    command: stringField(row.command) ?? "",
    when: stringField(row.when) ?? ""
  };
}

function startupRunSortTime(run: DashboardStartupRun): string {
  return run.completedAt ?? run.startedAt ?? "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function stringArrayField(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}
