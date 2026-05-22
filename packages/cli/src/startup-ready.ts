import { resolve } from "node:path";

import { collectRepoInspection } from "./inspection-evidence.js";
import type { LocalAgentWorkerKind } from "./local-agent.js";
import { resolveRunsteadRoot } from "./runstead-root.js";

export type StartupReadyStage = "mvp" | "launch" | "scale" | "complete";
export type StartupReadyTarget = "local" | "staging" | "production";

export interface StartupReadyOptions {
  cwd?: string;
  stage?: StartupReadyStage;
  target?: StartupReadyTarget;
  worker?: LocalAgentWorkerKind;
  plan?: boolean;
  resumeRunId?: string;
  writeCi?: boolean;
  ci?: boolean;
  now?: Date;
}

export interface StartupReadyPlan {
  cwd: string;
  stage: StartupReadyStage;
  target: StartupReadyTarget;
  worker: LocalAgentWorkerKind;
  runsteadInitialized: boolean;
  phases: StartupReadyPlanPhase[];
}

export interface StartupReadyPlanPhase {
  id: string;
  title: string;
  status: "pending" | "blocked" | "skipped";
  blockers: string[];
  nextAction?: string;
}

export async function planStartupReady(
  options: StartupReadyOptions = {}
): Promise<StartupReadyPlan> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const stage = options.stage ?? "launch";
  const target = options.target ?? "local";
  const worker = options.worker ?? "codex_cli";
  const now = options.now ?? new Date();
  const [root, inspection] = await Promise.all([
    resolveRunsteadRoot(cwd),
    collectRepoInspection(cwd, now.toISOString())
  ]);

  return {
    cwd,
    stage,
    target,
    worker,
    runsteadInitialized: root.source !== "missing",
    phases: [
      planPhase("onboard", "Onboard repo", root.source === "missing" ? [] : []),
      planPhase("context", "Generate context", []),
      planPhase("measurement", "Measurement framework", []),
      planPhase("build_mvp", "Build or repair MVP", []),
      planPhase("verifiers", "Run verifiers", verifierBlockers(inspection)),
      planPhase("ui_smoke", "UI smoke", []),
      planPhase("launch_audit", "Launch audit/security", []),
      planPhase("launch_report", "Launch report", []),
      planPhase("complete_check", "Complete product check", [])
    ].filter((phase) => phaseIncludedForStage(phase.id, stage))
  };
}

export async function runStartupReady(
  options: StartupReadyOptions = {}
): Promise<StartupReadyPlan> {
  if (options.plan !== true) {
    throw new Error(
      "startup ready execution is not wired yet. Use --plan to inspect the readiness run plan."
    );
  }

  return planStartupReady(options);
}

export function formatStartupReadyPlan(plan: StartupReadyPlan): string {
  return [
    "Startup readiness plan",
    `Workspace: ${plan.cwd}`,
    `Stage: ${plan.stage}`,
    `Target: ${plan.target}`,
    `Worker: ${plan.worker}`,
    `Runstead initialized: ${plan.runsteadInitialized ? "yes" : "no"}`,
    "",
    "Phases:",
    ...plan.phases.map(
      (phase, index) =>
        `${index + 1}. ${phase.title}: ${phase.status}${phase.blockers.length === 0 ? "" : ` (${phase.blockers.join("; ")})`}`
    )
  ].join("\n");
}

export function parseStartupReadyStage(value: string): StartupReadyStage {
  if (
    value === "mvp" ||
    value === "launch" ||
    value === "scale" ||
    value === "complete"
  ) {
    return value;
  }

  throw new Error(`Unsupported startup ready stage ${value}`);
}

export function parseStartupReadyTarget(value: string): StartupReadyTarget {
  if (value === "local" || value === "staging" || value === "production") {
    return value;
  }

  throw new Error(`Unsupported startup ready target ${value}`);
}

function planPhase(
  id: string,
  title: string,
  blockers: string[]
): StartupReadyPlanPhase {
  return {
    id,
    title,
    status: blockers.length === 0 ? "pending" : "blocked",
    blockers
  };
}

function verifierBlockers(
  inspection: Awaited<ReturnType<typeof collectRepoInspection>>
): string[] {
  return [
    inspection.commands.test.detected ? undefined : "test command is missing",
    inspection.commands.lint.detected ? undefined : "lint command is missing",
    inspection.commands.typecheck.detected ? undefined : "typecheck command is missing",
    inspection.commands.build.detected ? undefined : "build command is missing"
  ].filter((blocker): blocker is string => blocker !== undefined);
}

function phaseIncludedForStage(id: string, stage: StartupReadyStage): boolean {
  const mvp = new Set(["onboard", "context", "measurement", "build_mvp", "verifiers"]);
  const launch = new Set([...mvp, "ui_smoke", "launch_audit", "launch_report"]);
  const scale = new Set([...launch]);
  const complete = new Set([...launch, "complete_check"]);

  if (stage === "mvp") {
    return mvp.has(id);
  }

  if (stage === "launch") {
    return launch.has(id);
  }

  if (stage === "scale") {
    return scale.has(id);
  }

  return complete.has(id);
}
