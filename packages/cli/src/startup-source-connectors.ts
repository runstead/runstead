import type { JsonObject } from "@runstead/core";

import {
  addStartupEvidence,
  type AddStartupEvidenceResult,
  type StartupEvidenceType
} from "./startup-evidence.js";

export const STARTUP_SOURCE_CONNECTORS = [
  "github_actions",
  "github_pr",
  "github_issue",
  "deployment",
  "observability",
  "analytics",
  "billing",
  "support",
  "dependency"
] as const;

export type StartupSourceConnector = (typeof STARTUP_SOURCE_CONNECTORS)[number];

export interface RecordStartupSourceEvidenceOptions {
  cwd?: string;
  connector: string;
  uri: string;
  summary: string;
  status?: string;
  capturedAt?: string;
  freshnessDays?: number;
  sourceHash?: string;
  trustLevel?: string;
  payload?: string;
  goalId?: string;
  now?: Date;
}

export interface RecordStartupSourceEvidenceResult extends AddStartupEvidenceResult {
  connector: StartupSourceConnector;
  evidenceType: StartupEvidenceType;
}

export async function recordStartupSourceEvidence(
  options: RecordStartupSourceEvidenceOptions
): Promise<RecordStartupSourceEvidenceResult> {
  const connector = parseStartupSourceConnector(options.connector);
  const evidenceType = connectorEvidenceType(connector);
  const payload = connectorPayload(options.payload);
  const result = await addStartupEvidence({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    type: evidenceType,
    summary: options.summary,
    sources: [
      {
        uri: options.uri,
        kind: connectorSourceKind(connector),
        ...(options.capturedAt === undefined ? {} : { capturedAt: options.capturedAt }),
        ...(options.freshnessDays === undefined
          ? {}
          : { freshnessDays: options.freshnessDays }),
        ...(options.sourceHash === undefined ? {} : { hash: options.sourceHash }),
        ...(options.trustLevel === undefined ? {} : { trustLevel: options.trustLevel }),
        provenance: {
          connector,
          captureMode: "connector_ingest"
        }
      }
    ],
    content: JSON.stringify(
      {
        connector,
        status: options.status ?? "recorded",
        sourceUri: options.uri,
        trustLevel: options.trustLevel ?? "medium",
        ...(payload === undefined ? {} : { payload })
      },
      null,
      2
    ),
    ...(options.goalId === undefined ? {} : { goalId: options.goalId }),
    ...(options.now === undefined ? {} : { now: options.now })
  });

  return {
    ...result,
    connector,
    evidenceType
  };
}

export function parseStartupSourceConnector(value: string): StartupSourceConnector {
  if (STARTUP_SOURCE_CONNECTORS.includes(value as StartupSourceConnector)) {
    return value as StartupSourceConnector;
  }

  throw new Error(
    `Unsupported startup source connector ${value}. Expected one of: ${STARTUP_SOURCE_CONNECTORS.join(", ")}`
  );
}

function connectorEvidenceType(connector: StartupSourceConnector): StartupEvidenceType {
  switch (connector) {
    case "github_actions":
      return "repo_readiness";
    case "github_pr":
      return "decision";
    case "github_issue":
      return "support_triage";
    case "deployment":
      return "release_plan";
    case "observability":
      return "observability";
    case "analytics":
    case "billing":
      return "metric_snapshot";
    case "support":
      return "support_triage";
    case "dependency":
      return "security_baseline";
  }
}

function connectorSourceKind(connector: StartupSourceConnector): string {
  switch (connector) {
    case "github_actions":
      return "github_actions";
    case "github_pr":
      return "github_pull_request";
    case "github_issue":
      return "github_issue";
    case "deployment":
      return "deployment";
    case "observability":
      return "observability";
    case "analytics":
      return "analytics";
    case "billing":
      return "billing";
    case "support":
      return "support_ticket";
    case "dependency":
      return "dependency_scanner";
  }
}

function connectorPayload(payload: string | undefined): JsonObject | undefined {
  if (payload === undefined || payload.trim().length === 0) {
    return undefined;
  }

  const parsed = JSON.parse(payload) as unknown;

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("--payload must be a JSON object");
  }

  return parsed as JsonObject;
}
