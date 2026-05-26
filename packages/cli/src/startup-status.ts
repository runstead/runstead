import { resolve } from "node:path";

import { findInterruptedTasks, recoverStaleRunningTasks } from "./resume.js";
import { requireRunsteadStateDb } from "./runstead-root.js";
import {
  checkStartupGate,
  type StartupGateCheckResult,
  type StartupGateStage
} from "./startup-evidence.js";
import { readStartupStatusEvidence } from "./startup-status-evidence.js";
import { readLatestStartupReadinessSnapshot } from "./startup-readiness-snapshot.js";
import { startupVerdictReady } from "./startup-verdict.js";
import type {
  StartupStatusEvidenceSummary,
  StartupStatusExecutionSummary,
  StartupStatusGate,
  StartupStatusNextAction,
  StartupStatusOptions,
  StartupStatusReadinessVerdict,
  StartupStatusResult
} from "./startup-status-types.js";

export type {
  StartupStatusEvidenceItem,
  StartupStatusEvidenceSummary,
  StartupStatusExecutionSummary,
  StartupStatusGate,
  StartupStatusInterruptedTask,
  StartupStatusNextAction,
  StartupStatusOptions,
  StartupStatusReadinessVerdict,
  StartupStatusRecoveredTask,
  StartupStatusResult,
  StartupStatusStaleSource
} from "./startup-status-types.js";

const STARTUP_DOMAIN = "ai-native-startup";
const STARTUP_STAGES: StartupGateStage[] = ["mvp", "launch", "scale"];

export async function getStartupStatus(
  options: StartupStatusOptions = {}
): Promise<StartupStatusResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const domain = options.domain ?? STARTUP_DOMAIN;
  const now = options.now ?? new Date();
  const generatedAt = now.toISOString();
  const resolvedState = await requireRunsteadStateDb(cwd);
  const recovered = await recoverStaleRunningTasks({
    cwd,
    now
  });
  const interrupted = findInterruptedTasks({ cwd });
  const gateResults: StartupGateCheckResult[] = [];

  for (const stage of STARTUP_STAGES) {
    gateResults.push(
      await checkStartupGate({
        cwd,
        domain,
        stage,
        now: new Date(generatedAt),
        recordEvent: false
      })
    );
  }

  const evidence = readStartupStatusEvidence({
    stateDb: resolvedState.stateDb,
    generatedAt
  });
  const readiness = readLatestStartupReadinessSnapshot({
    root: resolvedState.root,
    stateDb: resolvedState.stateDb
  });
  const execution = startupStatusExecutionSummary(recovered, interrupted);
  const gates: StartupStatusGate[] = gateResults.map((gate) => ({
    stage: gate.stage,
    status: gate.passed ? "passed" : "blocked",
    blockers: gate.blockers,
    warnings: gate.warnings
  }));

  return {
    root: resolvedState.root,
    stateDb: resolvedState.stateDb,
    domain,
    generatedAt,
    currentStage: currentStartupStage(gates, readiness),
    gates,
    ...(readiness === undefined ? {} : { readiness }),
    execution,
    evidence,
    nextAction: nextStartupAction(gates, evidence, readiness)
  };
}

export function formatStartupStatus(result: StartupStatusResult): string {
  return [
    "Startup status",
    `Root: ${result.root}`,
    `Domain: ${result.domain}`,
    `Current stage: ${result.currentStage}`,
    ...(result.readiness === undefined
      ? []
      : [`Readiness verdict: ${result.readiness.verdict} (${result.readiness.runId})`]),
    `Recovered stale tasks: ${result.execution.recoveredTasks.length}`,
    `Active interrupted tasks: ${result.execution.interruptedTasks.length}`,
    `Evidence: ${result.evidence.total} record${result.evidence.total === 1 ? "" : "s"}`,
    ...(result.evidence.latest === undefined
      ? []
      : [
          `Latest evidence: ${result.evidence.latest.id} ${result.evidence.latest.type}`
        ]),
    `Stale sources: ${result.evidence.staleSources.length}`,
    "",
    "Gates:",
    ...result.gates.map(
      (gate) =>
        `- ${gate.stage}: ${gate.status} (${gate.blockers.length} blocker${gate.blockers.length === 1 ? "" : "s"})`
    ),
    "",
    "Next action:",
    `- ${result.nextAction.command}`,
    `  ${result.nextAction.reason}`,
    "",
    "Top blockers:",
    listOrNone(topBlockers(result.gates, result.readiness), (blocker) => `- ${blocker}`)
  ].join("\n");
}

function startupStatusExecutionSummary(
  recovered: Awaited<ReturnType<typeof recoverStaleRunningTasks>>,
  interrupted: ReturnType<typeof findInterruptedTasks>
): StartupStatusExecutionSummary {
  return {
    recoveredTasks: [
      ...recovered.requeuedTasks.map((item) => ({
        id: item.task.id,
        previousStatus: item.previousStatus,
        status: item.task.status
      })),
      ...recovered.failedTasks.map((item) => ({
        id: item.task.id,
        previousStatus: item.previousStatus,
        status: item.task.status
      }))
    ],
    interruptedTasks: interrupted.interruptedTasks.map((item) => ({
      id: item.task.id,
      status: item.task.status,
      type: item.task.type,
      updatedAt: item.task.updatedAt,
      reason: item.reason
    }))
  };
}

function currentStartupStage(
  gates: StartupStatusGate[],
  readiness: StartupStatusReadinessVerdict | undefined
): StartupGateStage {
  if (readinessVerdictReady(readiness)) {
    return readiness?.target === "local" ? "launch" : "scale";
  }

  const mvpGate = gates.find((gate) => gate.stage === "mvp");
  const launchGate = gates.find((gate) => gate.stage === "launch");
  const scaleGate = gates.find((gate) => gate.stage === "scale");

  if (mvpGate?.status === "blocked") {
    return "mvp";
  }

  if (scaleGate?.status === "passed") {
    return "scale";
  }

  if (launchGate?.status === "passed") {
    return "scale";
  }

  return launchGate?.status === "blocked" ? "launch" : "mvp";
}

function nextStartupAction(
  gates: StartupStatusGate[],
  evidence: StartupStatusEvidenceSummary,
  readiness: StartupStatusReadinessVerdict | undefined
): StartupStatusNextAction {
  if (readinessVerdictReady(readiness)) {
    return {
      command: "runstead startup ready --stage launch",
      reason: `Latest startup readiness run ${readiness.runId} reported ${readiness.verdict}.`
    };
  }

  const mvpGate = gates.find((gate) => gate.stage === "mvp");
  const launchGate = gates.find((gate) => gate.stage === "launch");
  const scaleGate = gates.find((gate) => gate.stage === "scale");

  if (evidence.total === 0) {
    return {
      command: "runstead startup onboard",
      reason: "No startup evidence is recorded yet."
    };
  }

  if (mvpGate?.status === "blocked") {
    return {
      command: "runstead startup gate check --stage mvp",
      reason: "MVP validation evidence is still blocking the build gate."
    };
  }

  if (launchGate?.status === "blocked") {
    return {
      command: "runstead startup remediate --stage launch --execute --worker codex_cli",
      reason: "Launch readiness has unresolved blockers."
    };
  }

  if (scaleGate?.status === "blocked") {
    return {
      command: "runstead startup scale-check",
      reason: "Launch is ready; scale handoff evidence is still incomplete."
    };
  }

  return {
    command: "runstead startup launch-check",
    reason: "All current startup gates pass; rerun launch readiness before release."
  };
}

function topBlockers(
  gates: StartupStatusGate[],
  readiness: StartupStatusReadinessVerdict | undefined
): string[] {
  if (readinessVerdictReady(readiness)) {
    return [];
  }

  return gates.flatMap((gate) =>
    gate.blockers.slice(0, 3).map((blocker) => `${gate.stage}: ${blocker}`)
  );
}

function readinessVerdictReady(
  readiness: StartupStatusReadinessVerdict | undefined
): readiness is StartupStatusReadinessVerdict {
  return readiness !== undefined && startupVerdictReady(readiness.verdict);
}

function listOrNone<T>(items: T[], formatter: (item: T) => string): string {
  return items.length === 0 ? "- none" : items.map(formatter).join("\n");
}
