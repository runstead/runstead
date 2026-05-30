import {
  requireRunsteadConnector,
  type RunsteadConnectorDefinition,
  type RunsteadConnectorId,
  type RunsteadConnectorSyncMode
} from "./connector-catalog.js";

export type RunsteadConnectorSyncStatus =
  | "disabled"
  | "contract_only"
  | "blocked_credentials"
  | "due"
  | "fresh"
  | "running"
  | "failed";

export interface RunsteadConnectorSyncCursor {
  kind: string;
  value: string;
  updatedAt: string;
}

export interface RunsteadConnectorSyncState {
  connector: RunsteadConnectorId;
  enabled: boolean;
  mode?: RunsteadConnectorSyncMode;
  profile?: string;
  cursor?: RunsteadConnectorSyncCursor;
  lastStartedAt?: string;
  lastCompletedAt?: string;
  runningSince?: string;
  nextSyncAfter?: string;
  lastError?: string;
}

export interface RunsteadConnectorSyncVerdict {
  connector: RunsteadConnectorId;
  status: RunsteadConnectorSyncStatus;
  mode: RunsteadConnectorSyncMode;
  profile?: string;
  cursor?: RunsteadConnectorSyncCursor;
  nextSyncAt?: string;
  missingCredentialEnv: string[];
  reason: string;
}

export function evaluateRunsteadConnectorSyncState(input: {
  connector: RunsteadConnectorId | RunsteadConnectorDefinition;
  state?: RunsteadConnectorSyncState;
  env?: Record<string, string | undefined>;
  now?: Date;
}): RunsteadConnectorSyncVerdict {
  const connector =
    typeof input.connector === "string"
      ? requireRunsteadConnector(input.connector)
      : input.connector;
  const state = input.state;
  const mode = state?.mode ?? connector.sync.defaultMode;
  const env = input.env ?? process.env;
  const now = input.now ?? new Date();
  const missingCredentialEnv = connector.credentialEnv.filter(
    (name) => !hasCredential(env[name])
  );
  const nextSyncAt = nextSyncTimestamp({
    connector,
    state,
    now
  });

  if (state?.enabled === false) {
    return verdict({
      connector,
      state,
      status: "disabled",
      mode,
      nextSyncAt,
      missingCredentialEnv,
      reason: "connector sync is disabled"
    });
  }

  if (connector.maturity === "catalog") {
    return verdict({
      connector,
      state,
      status: "contract_only",
      mode,
      nextSyncAt,
      missingCredentialEnv,
      reason: "connector sync contract exists, but no executable adapter is registered"
    });
  }

  if (missingCredentialEnv.length > 0) {
    return verdict({
      connector,
      state,
      status: "blocked_credentials",
      mode,
      nextSyncAt,
      missingCredentialEnv,
      reason: `missing credential env ${missingCredentialEnv.join(", ")}`
    });
  }

  if (state?.runningSince !== undefined) {
    return verdict({
      connector,
      state,
      status: "running",
      mode,
      nextSyncAt,
      missingCredentialEnv,
      reason: `sync running since ${state.runningSince}`
    });
  }

  if (state?.lastError !== undefined && state.lastError.trim().length > 0) {
    return verdict({
      connector,
      state,
      status: "failed",
      mode,
      nextSyncAt,
      missingCredentialEnv,
      reason: state.lastError
    });
  }

  if (nextSyncAt === undefined || Date.parse(nextSyncAt) <= now.getTime()) {
    return verdict({
      connector,
      state,
      status: "due",
      mode,
      nextSyncAt,
      missingCredentialEnv,
      reason:
        state?.lastCompletedAt === undefined
          ? "connector has never completed sync"
          : `connector sync is due after ${nextSyncAt}`
    });
  }

  return verdict({
    connector,
    state,
    status: "fresh",
    mode,
    nextSyncAt,
    missingCredentialEnv,
    reason: `connector sync is fresh until ${nextSyncAt}`
  });
}

export function formatRunsteadConnectorSyncVerdict(
  verdict: RunsteadConnectorSyncVerdict
): string {
  return [
    `Connector sync: ${verdict.connector}`,
    `Status: ${verdict.status}`,
    `Mode: ${verdict.mode}`,
    `Profile: ${verdict.profile ?? "default"}`,
    `Cursor: ${verdict.cursor === undefined ? "none" : `${verdict.cursor.kind}:${verdict.cursor.value}`}`,
    `Next sync: ${verdict.nextSyncAt ?? "now"}`,
    `Missing credentials: ${formatList(verdict.missingCredentialEnv)}`,
    `Reason: ${verdict.reason}`
  ].join("\n");
}

function verdict(input: {
  connector: RunsteadConnectorDefinition;
  state: RunsteadConnectorSyncState | undefined;
  status: RunsteadConnectorSyncStatus;
  mode: RunsteadConnectorSyncMode;
  nextSyncAt: string | undefined;
  missingCredentialEnv: string[];
  reason: string;
}): RunsteadConnectorSyncVerdict {
  return {
    connector: input.connector.id,
    status: input.status,
    mode: input.mode,
    ...(input.state?.profile === undefined ? {} : { profile: input.state.profile }),
    ...(input.state?.cursor === undefined ? {} : { cursor: input.state.cursor }),
    ...(input.nextSyncAt === undefined ? {} : { nextSyncAt: input.nextSyncAt }),
    missingCredentialEnv: input.missingCredentialEnv,
    reason: input.reason
  };
}

function nextSyncTimestamp(input: {
  connector: RunsteadConnectorDefinition;
  state: RunsteadConnectorSyncState | undefined;
  now: Date;
}): string | undefined {
  if (input.state?.nextSyncAfter !== undefined) {
    return input.state.nextSyncAfter;
  }

  if (input.state?.lastCompletedAt === undefined) {
    return undefined;
  }

  const freshnessMs = input.connector.sync.defaultFreshnessMs;

  if (freshnessMs === undefined) {
    return input.now.toISOString();
  }

  const completedAtMs = Date.parse(input.state.lastCompletedAt);

  if (!Number.isFinite(completedAtMs)) {
    return input.now.toISOString();
  }

  return new Date(completedAtMs + freshnessMs).toISOString();
}

function hasCredential(value: string | undefined): boolean {
  return value !== undefined && value.trim().length > 0;
}

function formatList(values: string[]): string {
  if (values.length === 0) {
    return "0";
  }

  return `${values.length} (${values.join(", ")})`;
}
