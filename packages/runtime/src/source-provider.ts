import type { JsonObject } from "@runstead/core";

export type RuntimeSourceProviderKind =
  | "github"
  | "gitlab"
  | "linear"
  | "jira"
  | "slack"
  | "docs"
  | "vercel"
  | "render"
  | "sentry"
  | "posthog";

export interface RuntimeSourceProviderAdapter {
  connector: string;
  provider: RuntimeSourceProviderKind;
  requiredTokenEnv?: string;
}

export interface RuntimeSourceProviderDefinition {
  displayName: string;
}

export interface RuntimeSourceProviderCollection {
  status: "passed" | "failed" | "unknown";
  summary: string;
  payload: JsonObject;
}

export interface RuntimeSourceConnectorResponseJsonParseResult {
  payload: JsonObject;
  parseError?: string;
  responseExcerpt?: string;
}

export function parseRuntimeSourceConnectorResponseJson(
  value: string,
  options?: {
    secrets?: string[];
  }
): RuntimeSourceConnectorResponseJsonParseResult {
  if (value.trim().length === 0) {
    return { payload: {} };
  }

  try {
    const parsed = JSON.parse(value) as unknown;

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return {
        payload: {},
        parseError: "connector response must be a JSON object",
        responseExcerpt: redactSecrets(
          boundedProviderText(value, 2_000),
          options?.secrets ?? []
        )
      };
    }

    return {
      payload: redactJsonObject(parsed as JsonObject, options?.secrets ?? [])
    };
  } catch (error) {
    return {
      payload: {},
      parseError: error instanceof Error ? error.message : "invalid JSON response",
      responseExcerpt: redactSecrets(
        boundedProviderText(value, 2_000),
        options?.secrets ?? []
      )
    };
  }
}

export function runtimeSourceProviderAuthHeaders(
  adapter: RuntimeSourceProviderAdapter,
  token: string
): Record<string, string> {
  switch (adapter.provider) {
    case "github":
      return {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json"
      };
    case "gitlab":
      return {
        "PRIVATE-TOKEN": token
      };
    case "linear":
    case "jira":
    case "slack":
    case "docs":
    case "sentry":
    case "posthog":
    case "vercel":
    case "render":
      return {
        Authorization: `Bearer ${token}`
      };
  }
}

export function collectRuntimeSourceProviderPayload(input: {
  adapter: RuntimeSourceProviderAdapter;
  definition: RuntimeSourceProviderDefinition;
  responseStatus: number;
  responseOk: boolean;
  responsePayload: JsonObject;
  parseError?: string;
  responseExcerpt?: string;
}): RuntimeSourceProviderCollection {
  if (input.parseError !== undefined) {
    return {
      status: "failed",
      summary: `${input.definition.displayName} adapter returned invalid JSON`,
      payload: {
        connector: input.adapter.connector,
        provider: input.adapter.provider,
        httpStatus: input.responseStatus,
        parseError: input.parseError,
        ...(input.responseExcerpt === undefined
          ? {}
          : { responseExcerpt: input.responseExcerpt })
      }
    };
  }

  if (!input.responseOk) {
    return {
      status: "failed",
      summary: `${input.definition.displayName} adapter fetch failed with HTTP ${input.responseStatus}`,
      payload: {
        connector: input.adapter.connector,
        provider: input.adapter.provider,
        httpStatus: input.responseStatus,
        response: input.responsePayload
      }
    };
  }

  switch (input.adapter.connector) {
    case "github_actions":
      return collectGithubActionsPayload(input.responsePayload);
    case "gitlab_ci":
      return collectGitlabCiPayload(input.responsePayload);
    case "vercel":
      return collectDeploymentPayload({
        connector: "vercel",
        displayName: input.definition.displayName,
        readyStates: ["READY", "SUCCESS", "SUCCEEDED"],
        payload: input.responsePayload
      });
    case "render":
      return collectDeploymentPayload({
        connector: "render",
        displayName: input.definition.displayName,
        readyStates: ["live", "deployed", "succeeded", "success"],
        payload: input.responsePayload
      });
    case "sentry":
      return collectSentryPayload(input.responsePayload);
    case "posthog":
      return collectPosthogPayload(input.responsePayload);
    default:
      return {
        status: "unknown",
        summary: `${input.definition.displayName} adapter has no parser`,
        payload: input.responsePayload
      };
  }
}

function collectGitlabCiPayload(payload: JsonObject): RuntimeSourceProviderCollection {
  const status = stringPayloadValue(payload, "status");
  const pipeline =
    stringPayloadValue(payload, "pipeline") ??
    stringPayloadValue(payload, "name") ??
    stringPayloadValue(payload, "id") ??
    numberPayloadValue(payload, "id")?.toString();
  const normalizedStatus = normalizeProviderState(status);
  const passed = normalizedStatus === "success" || normalizedStatus === "passed";
  const failed =
    normalizedStatus === "failed" ||
    normalizedStatus === "failure" ||
    normalizedStatus === "canceled" ||
    normalizedStatus === "cancelled" ||
    normalizedStatus === "skipped";
  const collectionStatus: RuntimeSourceProviderCollection["status"] = passed
    ? "passed"
    : failed
      ? "failed"
      : "unknown";

  return {
    status: collectionStatus,
    summary: `GitLab CI ${pipeline ?? "pipeline"} status ${status ?? "unknown"}`,
    payload
  };
}

function collectGithubActionsPayload(
  payload: JsonObject
): RuntimeSourceProviderCollection {
  const conclusion = stringPayloadValue(payload, "conclusion");
  const status = stringPayloadValue(payload, "status");
  const workflow =
    stringPayloadValue(payload, "workflow") ?? stringPayloadValue(payload, "name");
  const normalizedConclusion = normalizeProviderState(conclusion);
  const normalizedStatus = normalizeProviderState(status);
  const passed = normalizedConclusion === "success" || normalizedStatus === "success";
  const failed =
    normalizedConclusion === "failure" ||
    normalizedConclusion === "failed" ||
    normalizedConclusion === "cancelled" ||
    normalizedConclusion === "canceled" ||
    normalizedConclusion === "timed_out" ||
    normalizedConclusion === "action_required";
  const pending =
    normalizedStatus !== undefined &&
    normalizedStatus !== "completed" &&
    normalizedStatus !== "success";
  const collectionStatus: RuntimeSourceProviderCollection["status"] = passed
    ? "passed"
    : failed
      ? "failed"
      : "unknown";

  return {
    status: pending && collectionStatus !== "failed" ? "unknown" : collectionStatus,
    summary: `GitHub Actions workflow ${workflow ?? "run"} ${conclusion ?? status ?? "unknown"}`,
    payload: {
      workflow: workflow ?? "unknown",
      conclusion: conclusion ?? "unknown",
      status: status ?? "unknown",
      headSha:
        stringPayloadValue(payload, "headSha") ??
        stringPayloadValue(payload, "head_sha") ??
        "unknown",
      runId: payload.runId ?? payload.id ?? "unknown"
    }
  };
}

function collectDeploymentPayload(input: {
  connector: string;
  displayName: string;
  readyStates: string[];
  payload: JsonObject;
}): RuntimeSourceProviderCollection {
  const status =
    stringPayloadValue(input.payload, "status") ??
    stringPayloadValue(input.payload, "state") ??
    stringPayloadValue(input.payload, "readyState") ??
    "unknown";
  const normalizedStatus = normalizeProviderState(status);
  const readyStates = new Set(
    input.readyStates.map((state) => normalizeProviderState(state))
  );
  const passed = normalizedStatus !== undefined && readyStates.has(normalizedStatus);
  const failed =
    normalizedStatus !== undefined &&
    [
      "error",
      "failed",
      "failure",
      "canceled",
      "cancelled",
      "crashed",
      "timed_out"
    ].includes(normalizedStatus);
  const unknown =
    normalizedStatus === undefined ||
    [
      "unknown",
      "initializing",
      "queued",
      "building",
      "build_in_progress",
      "deploying",
      "pending",
      "created",
      "update_in_progress"
    ].includes(normalizedStatus);
  const collectionStatus: RuntimeSourceProviderCollection["status"] = passed
    ? "passed"
    : failed
      ? "failed"
      : unknown
        ? "unknown"
        : "failed";

  return {
    status: collectionStatus,
    summary: `${input.displayName} deployment ${status}`,
    payload: {
      connector: input.connector,
      status,
      deploymentUrl:
        stringPayloadValue(input.payload, "deploymentUrl") ??
        stringPayloadValue(input.payload, "url") ??
        "unknown",
      commitSha:
        stringPayloadValue(input.payload, "commitSha") ??
        stringPayloadValue(input.payload, "commit") ??
        "unknown"
    }
  };
}

function collectSentryPayload(payload: JsonObject): RuntimeSourceProviderCollection {
  const blockers =
    numberPayloadValue(payload, "openReleaseBlockers") ??
    numberPayloadValue(payload, "issueCount") ??
    numberPayloadValue(payload, "newGroups") ??
    arrayPayloadLength(payload, "issues");
  const status: RuntimeSourceProviderCollection["status"] =
    blockers === undefined ? "unknown" : blockers === 0 ? "passed" : "failed";
  const blockerSummary = blockers === undefined ? "unknown" : String(blockers);
  const project = recordPayloadValue(payload, "project");

  return {
    status,
    summary: `Sentry release blockers: ${blockerSummary}`,
    payload: {
      openReleaseBlockers: blockers ?? "unknown",
      release:
        stringPayloadValue(payload, "release") ??
        stringPayloadValue(payload, "version") ??
        "unknown",
      project:
        stringPayloadValue(payload, "project") ??
        (project === undefined ? undefined : stringPayloadValue(project, "name")) ??
        "unknown"
    }
  };
}

function collectPosthogPayload(payload: JsonObject): RuntimeSourceProviderCollection {
  const value =
    numberPayloadValue(payload, "value") ?? posthogInsightNumericValue(payload.result);
  const threshold = numberPayloadValue(payload, "threshold");
  const realUserData =
    payload.realUserData === true ||
    (payload.id !== undefined &&
      (payload.short_id !== undefined || payload.result !== undefined));
  const passed =
    value !== undefined &&
    realUserData &&
    (threshold === undefined || value >= threshold);
  const status: RuntimeSourceProviderCollection["status"] =
    value === undefined ? "unknown" : passed ? "passed" : "failed";

  return {
    status,
    summary: `PostHog metric ${
      stringPayloadValue(payload, "metric") ??
      stringPayloadValue(payload, "name") ??
      stringPayloadValue(payload, "derived_name") ??
      "activation"
    } value ${value ?? "unknown"}`,
    payload: {
      metric:
        stringPayloadValue(payload, "metric") ??
        stringPayloadValue(payload, "name") ??
        stringPayloadValue(payload, "derived_name") ??
        "activation",
      value: value ?? "unknown",
      ...(threshold === undefined ? {} : { threshold }),
      window: stringPayloadValue(payload, "window") ?? "unknown",
      realUserData
    }
  };
}

function stringPayloadValue(payload: JsonObject, field: string): string | undefined {
  const value = payload[field];

  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function recordPayloadValue(
  payload: JsonObject,
  field: string
): Record<string, unknown> | undefined {
  const value = payload[field];

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
}

function normalizeProviderState(value: string | undefined): string | undefined {
  return value?.trim().toLowerCase();
}

function numberPayloadValue(payload: JsonObject, field: string): number | undefined {
  const value = payload[field];

  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function numberRecordValue(
  payload: Record<string, unknown>,
  field: string
): number | undefined {
  const value = payload[field];

  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function posthogInsightNumericValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const result = posthogInsightNumericValue(item);

      if (result !== undefined) {
        return result;
      }
    }

    return undefined;
  }

  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  const record = value as Record<string, unknown>;

  return (
    numberRecordValue(record, "value") ??
    numberRecordValue(record, "count") ??
    numberRecordValue(record, "aggregated_value")
  );
}

function arrayPayloadLength(payload: JsonObject, field: string): number | undefined {
  const value = payload[field];

  return Array.isArray(value) ? value.length : undefined;
}

function redactJsonObject(payload: JsonObject, secrets: string[]): JsonObject {
  return redactJsonValue(payload, secrets) as JsonObject;
}

function redactJsonValue(value: unknown, secrets: string[]): unknown {
  if (typeof value === "string") {
    return redactSecrets(value, secrets);
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactJsonValue(item, secrets));
  }

  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        sensitiveProviderField(key) ? "[redacted]" : redactJsonValue(entry, secrets)
      ])
    );
  }

  return value;
}

function sensitiveProviderField(key: string): boolean {
  return /(?:authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|bearer)/iu.test(
    key
  );
}

function redactSecrets(value: string, secrets: string[]): string {
  return secrets
    .filter((secret) => secret.trim().length > 0)
    .reduce((redacted, secret) => redacted.split(secret).join("[redacted]"), value);
}

function boundedProviderText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength)}...`;
}
