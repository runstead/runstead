import { resolve } from "node:path";

import { generateLaunchReadinessReport } from "./launch-readiness-report.js";
import { generateOpsDiagnosticsBundle } from "./ops-diagnostics.js";
import { startupOnboard } from "./startup-founder-flow.js";
import {
  checkStartupGate,
  type AddStartupEvidenceOptions,
  type StartupGateStage,
  addStartupEvidence
} from "./startup-evidence.js";
import {
  recordStartupSourceEvidence,
  type RecordStartupSourceEvidenceOptions
} from "./startup-source-connectors.js";
import { getStartupStatus, type StartupStatusResult } from "./startup-status.js";

export interface StartupReadinessClientOptions {
  cwd?: string;
  domain?: string;
}

export interface StartupApiSnapshotOptions extends StartupReadinessClientOptions {
  now?: Date;
}

export interface StartupApiSnapshot {
  schemaVersion: 1;
  generatedAt: string;
  root: string;
  domain: string;
  status: StartupStatusResult;
  contracts: {
    evidencePrefix: "startup_";
    artifactSchemaVersion: 1;
    webhookIngest: "startup.source.record";
  };
}

export interface StartupWebhookEvidenceOptions extends Omit<
  RecordStartupSourceEvidenceOptions,
  "uri" | "payload" | "summary"
> {
  uri?: string;
  summary?: string;
  payload: unknown;
}

export function createStartupReadinessClient(
  defaults: StartupReadinessClientOptions = {}
) {
  const cwd = resolve(defaults.cwd ?? process.cwd());
  const domain = defaults.domain ?? "ai-native-startup";

  return {
    snapshot: (options: Omit<StartupApiSnapshotOptions, "cwd" | "domain"> = {}) =>
      startupApiSnapshot({ cwd, domain, ...options }),
    onboard: () => startupOnboard({ cwd }),
    checkGate: (stage: StartupGateStage) => checkStartupGate({ cwd, domain, stage }),
    recordEvidence: (options: Omit<AddStartupEvidenceOptions, "cwd">) =>
      addStartupEvidence({ cwd, ...options }),
    recordSourceEvidence: (options: Omit<RecordStartupSourceEvidenceOptions, "cwd">) =>
      recordStartupSourceEvidence({ cwd, ...options }),
    ingestWebhook: (options: Omit<StartupWebhookEvidenceOptions, "cwd">) =>
      ingestStartupWebhookEvidence({ cwd, ...options }),
    launchReport: () => generateLaunchReadinessReport({ cwd, domain }),
    diagnostics: () => generateOpsDiagnosticsBundle({ cwd })
  };
}

export async function startupApiSnapshot(
  options: StartupApiSnapshotOptions = {}
): Promise<StartupApiSnapshot> {
  const status = await getStartupStatus(options);

  return {
    schemaVersion: 1,
    generatedAt: status.generatedAt,
    root: status.root,
    domain: status.domain,
    status,
    contracts: {
      evidencePrefix: "startup_",
      artifactSchemaVersion: 1,
      webhookIngest: "startup.source.record"
    }
  };
}

export async function ingestStartupWebhookEvidence(
  options: StartupWebhookEvidenceOptions
) {
  const capturedAt = (options.now ?? new Date()).toISOString();
  const payloadJson = JSON.stringify(options.payload, null, 2);

  return recordStartupSourceEvidence({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    connector: options.connector,
    uri: options.uri ?? `webhook:${options.connector}:${capturedAt}`,
    summary: options.summary ?? `Webhook ${options.connector} evidence`,
    capturedAt,
    payload: payloadJson,
    ...(options.status === undefined ? {} : { status: options.status }),
    ...(options.freshnessDays === undefined
      ? {}
      : { freshnessDays: options.freshnessDays }),
    ...(options.sourceHash === undefined ? {} : { sourceHash: options.sourceHash }),
    ...(options.trustLevel === undefined ? {} : { trustLevel: options.trustLevel }),
    ...(options.goalId === undefined ? {} : { goalId: options.goalId }),
    ...(options.now === undefined ? {} : { now: options.now })
  });
}
