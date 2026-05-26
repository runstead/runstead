import { createRunsteadId, type JsonObject, type RunsteadEvent } from "@runstead/core";

export interface RuntimeReadinessRunPhaseSnapshot {
  id: string;
  title: string;
  status: string;
  evidenceIds: string[];
  artifacts: string[];
  blockers: string[];
  nextAction?: string;
}

export interface RuntimeReadinessRunSnapshot {
  schemaVersion: number;
  id: string;
  cwd: string;
  stage: string;
  target: string;
  worker: string;
  governanceProfile?: string;
  runtimeBackend?: JsonObject;
  status: string;
  phases: RuntimeReadinessRunPhaseSnapshot[];
  evidenceIds: string[];
  evidenceTiers: string[];
  evidenceTypes: string[];
  verdict: string;
  verdictBlockers: string[];
  reportPaths: string[];
  guidedFlow: unknown[];
  operatorCommands: unknown[];
  startedAt: string;
  completedAt?: string;
  gitHead?: string;
  dirtyState: string;
  codeFingerprint?: string;
}

export interface CreateReadinessRunSnapshotEventOptions {
  path: string;
  now?: Date;
}

export function createReadinessRunSnapshotEvent(
  run: RuntimeReadinessRunSnapshot,
  options: CreateReadinessRunSnapshotEventOptions
): RunsteadEvent {
  const createdAt = run.completedAt ?? (options.now ?? new Date()).toISOString();

  return {
    eventId: createRunsteadId("evt"),
    type: "startup_readiness.run_snapshot",
    aggregateType: "startup_readiness_run",
    aggregateId: run.id,
    payload: readinessRunSnapshotPayload(run, options.path),
    createdAt
  };
}

export function readinessRunSnapshotPayload(
  run: RuntimeReadinessRunSnapshot,
  path: string
): JsonObject {
  return {
    runId: run.id,
    schemaVersion: run.schemaVersion,
    path,
    cwd: run.cwd,
    stage: run.stage,
    target: run.target,
    worker: run.worker,
    governanceProfile: readinessRunGovernanceProfile(run),
    ...(run.runtimeBackend === undefined ? {} : { runtimeBackend: run.runtimeBackend }),
    status: run.status,
    verdict: run.verdict,
    verdictBlockers: run.verdictBlockers,
    evidenceIds: run.evidenceIds,
    evidenceTiers: run.evidenceTiers,
    evidenceTypes: run.evidenceTypes,
    reportPaths: run.reportPaths,
    phases: run.phases.map((phase) => ({
      id: phase.id,
      title: phase.title,
      status: phase.status,
      evidenceIds: phase.evidenceIds,
      artifacts: phase.artifacts,
      blockers: phase.blockers,
      ...(phase.nextAction === undefined ? {} : { nextAction: phase.nextAction })
    })),
    guidedFlow: run.guidedFlow,
    operatorCommands: run.operatorCommands,
    startedAt: run.startedAt,
    ...(run.completedAt === undefined ? {} : { completedAt: run.completedAt }),
    ...(run.gitHead === undefined ? {} : { gitHead: run.gitHead }),
    dirtyState: run.dirtyState,
    ...(run.codeFingerprint === undefined
      ? {}
      : { codeFingerprint: run.codeFingerprint })
  };
}

export function readinessRunGovernanceProfile(
  run: Pick<RuntimeReadinessRunSnapshot, "worker" | "governanceProfile">
): string {
  return (
    run.governanceProfile ?? (run.worker === "codex_direct" ? "governed" : "readiness")
  );
}
