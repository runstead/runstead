import type { JsonObject } from "@runstead/core";
import {
  defineEvidenceSource,
  type EvidenceQualityTier,
  type EvidenceSourceTrust
} from "@runstead/evidence";

import {
  addStartupEvidence,
  type AddStartupEvidenceResult,
  type StartupEvidenceType
} from "./startup-evidence.js";

export const STARTUP_SOURCE_CONNECTORS = [
  "github_actions",
  "github_pr",
  "github_issue",
  "vercel",
  "fly",
  "render",
  "deployment",
  "sentry",
  "observability",
  "posthog",
  "analytics",
  "billing",
  "support",
  "dependency"
] as const;

export type StartupSourceConnector = (typeof STARTUP_SOURCE_CONNECTORS)[number];
export type StartupSourceTarget = "local" | "staging" | "production";

export interface StartupSourceConnectorDefinition {
  connector: StartupSourceConnector;
  displayName: string;
  evidenceType: StartupEvidenceType;
  sourceKind: string;
  qualityTier: EvidenceQualityTier;
  defaultTrustLevel: EvidenceSourceTrust;
  defaultFreshnessDays: number;
  recommendedPayloadFields: string[];
  readinessUse: string;
}

export interface RecordStartupSourceEvidenceOptions {
  cwd?: string;
  connector: string;
  uri: string;
  summary: string;
  status?: string;
  target?: string;
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
  definition: StartupSourceConnectorDefinition;
  qualityTier: EvidenceQualityTier;
  target?: StartupSourceTarget;
  readinessTiers: string[];
  payloadWarnings: string[];
}

export interface VerifyStartupSourceEvidenceOptions {
  cwd?: string;
  connector: string;
  uri: string;
  summary?: string;
  method?: string;
  expectStatus?: number;
  expectText?: string[];
  target?: string;
  capturedAt?: string;
  freshnessDays?: number;
  sourceHash?: string;
  trustLevel?: string;
  goalId?: string;
  fetch?: StartupSourceVerificationFetch;
  now?: Date;
}

export interface StartupSourceVerificationResult {
  status: "passed" | "failed";
  ok: boolean;
  statusCode: number;
  expectedStatus: number;
  textChecks: StartupSourceVerificationTextCheck[];
  responseExcerpt?: string;
}

export interface StartupSourceVerificationTextCheck {
  text: string;
  matched: boolean;
}

export interface VerifyStartupSourceEvidenceResult extends RecordStartupSourceEvidenceResult {
  verification: StartupSourceVerificationResult;
}

export type StartupSourceVerificationFetch = (
  input: string,
  init?: {
    method?: string;
    signal?: AbortSignal;
    headers?: Record<string, string>;
  }
) => Promise<StartupSourceVerificationResponse>;

export interface StartupSourceVerificationResponse {
  ok: boolean;
  status: number;
  text?: () => Promise<string>;
}

const STARTUP_SOURCE_CONNECTOR_DEFINITIONS: StartupSourceConnectorDefinition[] = [
  connectorDefinition({
    connector: "github_actions",
    displayName: "GitHub Actions",
    evidenceType: "repo_readiness",
    sourceKind: "github_actions",
    qualityTier: "external_observed",
    defaultTrustLevel: "authoritative",
    defaultFreshnessDays: 7,
    recommendedPayloadFields: ["workflow", "conclusion", "headSha"],
    readinessUse: "CI and remote verifier evidence"
  }),
  connectorDefinition({
    connector: "github_pr",
    displayName: "GitHub Pull Request",
    evidenceType: "decision",
    sourceKind: "github_pull_request",
    qualityTier: "external_observed",
    defaultTrustLevel: "high",
    defaultFreshnessDays: 14,
    recommendedPayloadFields: ["number", "state", "merged"],
    readinessUse: "review, approval, and launch decision evidence"
  }),
  connectorDefinition({
    connector: "github_issue",
    displayName: "GitHub Issue",
    evidenceType: "support_triage",
    sourceKind: "github_issue",
    qualityTier: "external_observed",
    defaultTrustLevel: "medium",
    defaultFreshnessDays: 30,
    recommendedPayloadFields: ["number", "state", "labels"],
    readinessUse: "support, feedback, or incident triage evidence"
  }),
  connectorDefinition({
    connector: "vercel",
    displayName: "Vercel Deployment",
    evidenceType: "release_plan",
    sourceKind: "vercel_deployment",
    qualityTier: "external_observed",
    defaultTrustLevel: "high",
    defaultFreshnessDays: 7,
    recommendedPayloadFields: ["environment", "deploymentUrl", "commitSha", "status"],
    readinessUse: "Vercel staging or production deployment evidence"
  }),
  connectorDefinition({
    connector: "fly",
    displayName: "Fly.io Deployment",
    evidenceType: "release_plan",
    sourceKind: "fly_deployment",
    qualityTier: "external_observed",
    defaultTrustLevel: "high",
    defaultFreshnessDays: 7,
    recommendedPayloadFields: ["app", "environment", "releaseId", "status"],
    readinessUse: "Fly.io staging or production deployment evidence"
  }),
  connectorDefinition({
    connector: "render",
    displayName: "Render Deployment",
    evidenceType: "release_plan",
    sourceKind: "render_deployment",
    qualityTier: "external_observed",
    defaultTrustLevel: "high",
    defaultFreshnessDays: 7,
    recommendedPayloadFields: ["service", "environment", "deployId", "status"],
    readinessUse: "Render staging or production deployment evidence"
  }),
  connectorDefinition({
    connector: "deployment",
    displayName: "Deployment",
    evidenceType: "release_plan",
    sourceKind: "deployment",
    qualityTier: "external_observed",
    defaultTrustLevel: "high",
    defaultFreshnessDays: 7,
    recommendedPayloadFields: ["environment", "version", "status"],
    readinessUse: "staging or production deployment evidence"
  }),
  connectorDefinition({
    connector: "sentry",
    displayName: "Sentry",
    evidenceType: "monitoring_alerts",
    sourceKind: "sentry_monitoring",
    qualityTier: "external_observed",
    defaultTrustLevel: "high",
    defaultFreshnessDays: 7,
    recommendedPayloadFields: ["project", "release", "alertStatus"],
    readinessUse: "production monitoring and alert evidence"
  }),
  connectorDefinition({
    connector: "observability",
    displayName: "Observability",
    evidenceType: "observability",
    sourceKind: "observability",
    qualityTier: "external_observed",
    defaultTrustLevel: "high",
    defaultFreshnessDays: 14,
    recommendedPayloadFields: ["dashboard", "alert", "status"],
    readinessUse: "monitoring, alert, and post-launch watch evidence"
  }),
  connectorDefinition({
    connector: "posthog",
    displayName: "PostHog",
    evidenceType: "metric_snapshot",
    sourceKind: "posthog_analytics",
    qualityTier: "external_observed",
    defaultTrustLevel: "high",
    defaultFreshnessDays: 14,
    recommendedPayloadFields: ["metric", "value", "window", "realUserData"],
    readinessUse: "real-user product analytics evidence"
  }),
  connectorDefinition({
    connector: "analytics",
    displayName: "Analytics",
    evidenceType: "metric_snapshot",
    sourceKind: "analytics",
    qualityTier: "external_observed",
    defaultTrustLevel: "high",
    defaultFreshnessDays: 14,
    recommendedPayloadFields: ["metric", "value", "window"],
    readinessUse: "activation, retention, and real-user metric evidence"
  }),
  connectorDefinition({
    connector: "billing",
    displayName: "Billing",
    evidenceType: "metric_snapshot",
    sourceKind: "billing",
    qualityTier: "external_observed",
    defaultTrustLevel: "high",
    defaultFreshnessDays: 30,
    recommendedPayloadFields: ["metric", "value", "period"],
    readinessUse: "revenue and conversion metric evidence"
  }),
  connectorDefinition({
    connector: "support",
    displayName: "Support",
    evidenceType: "support_triage",
    sourceKind: "support_ticket",
    qualityTier: "external_observed",
    defaultTrustLevel: "medium",
    defaultFreshnessDays: 30,
    recommendedPayloadFields: ["ticketId", "status", "severity"],
    readinessUse: "support ticket and feedback triage evidence"
  }),
  connectorDefinition({
    connector: "dependency",
    displayName: "Dependency Scanner",
    evidenceType: "security_baseline",
    sourceKind: "dependency_scanner",
    qualityTier: "external_observed",
    defaultTrustLevel: "high",
    defaultFreshnessDays: 30,
    recommendedPayloadFields: ["scanner", "critical", "high"],
    readinessUse: "dependency and vulnerability scan evidence"
  })
];

export async function recordStartupSourceEvidence(
  options: RecordStartupSourceEvidenceOptions
): Promise<RecordStartupSourceEvidenceResult> {
  const connector = parseStartupSourceConnector(options.connector);
  const definition = requireStartupSourceConnectorDefinition(connector);
  const evidenceType = definition.evidenceType;
  const target = parseOptionalStartupSourceTarget(options.target);
  const payload = connectorPayload(options.payload);
  const payloadWarnings = connectorPayloadWarnings(definition, payload);
  const readinessTiers = startupSourceTargetEvidenceTiers({
    connector,
    definition,
    target
  });
  const content = startupSourceEvidenceContent({
    connector,
    definition,
    status: options.status ?? "recorded",
    target,
    sourceUri: options.uri,
    sourceKind: definition.sourceKind,
    qualityTier: definition.qualityTier,
    trustLevel: options.trustLevel ?? definition.defaultTrustLevel,
    freshnessDays: options.freshnessDays ?? definition.defaultFreshnessDays,
    readinessTiers,
    readinessUse: definition.readinessUse,
    payloadWarnings,
    payload
  });
  const source = defineEvidenceSource({
    kind: definition.sourceKind,
    uri: options.uri,
    capturedAt: options.capturedAt ?? (options.now ?? new Date()).toISOString(),
    freshnessDays: options.freshnessDays ?? definition.defaultFreshnessDays,
    ...(options.sourceHash === undefined ? {} : { hash: options.sourceHash }),
    trust: parseEvidenceSourceTrust(options.trustLevel ?? definition.defaultTrustLevel)
  });
  const result = await addStartupEvidence({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    type: evidenceType,
    summary: options.summary,
    sources: [
      {
        uri: source.uri,
        kind: source.kind,
        ...(source.capturedAt === undefined ? {} : { capturedAt: source.capturedAt }),
        ...(source.freshnessDays === undefined
          ? {}
          : { freshnessDays: source.freshnessDays }),
        ...(source.hash === undefined ? {} : { hash: source.hash }),
        ...(source.trust === undefined ? {} : { trustLevel: source.trust }),
        provenance: {
          connector,
          captureMode: "connector_ingest",
          qualityTier: definition.qualityTier,
          ...(target === undefined ? {} : { target }),
          readinessTiers,
          readinessUse: definition.readinessUse,
          recommendedPayloadFields: definition.recommendedPayloadFields,
          payloadWarnings
        }
      }
    ],
    content: JSON.stringify(content, null, 2),
    ...(options.goalId === undefined ? {} : { goalId: options.goalId }),
    ...(options.now === undefined ? {} : { now: options.now })
  });

  return {
    ...result,
    connector,
    evidenceType,
    definition,
    qualityTier: definition.qualityTier,
    ...(target === undefined ? {} : { target }),
    readinessTiers,
    payloadWarnings
  };
}

export async function verifyStartupSourceEvidence(
  options: VerifyStartupSourceEvidenceOptions
): Promise<VerifyStartupSourceEvidenceResult> {
  const connector = parseStartupSourceConnector(options.connector);
  const definition = requireStartupSourceConnectorDefinition(connector);
  const fetcher = options.fetch ?? globalThis.fetch;

  if (fetcher === undefined) {
    throw new Error("fetch API is unavailable; provide a fetch implementation");
  }

  const expectedStatus = options.expectStatus ?? 200;
  const response = await fetcher(options.uri, {
    method: options.method ?? "GET",
    signal: AbortSignal.timeout(10_000)
  });
  const responseText = await readVerificationResponseText(response);
  const textChecks = (options.expectText ?? []).map((text) => ({
    text,
    matched: responseText.includes(text)
  }));
  const passed =
    response.status === expectedStatus && textChecks.every((check) => check.matched);
  const verification: StartupSourceVerificationResult = {
    status: passed ? "passed" : "failed",
    ok: response.ok,
    statusCode: response.status,
    expectedStatus,
    textChecks,
    ...(responseText.trim().length === 0
      ? {}
      : { responseExcerpt: boundedText(responseText, 4_000) })
  };
  const payload: JsonObject = {
    connector,
    verification,
    sourceUri: options.uri,
    sourceKind: definition.sourceKind,
    qualityTier: definition.qualityTier,
    readinessUse: definition.readinessUse
  };
  const result = await recordStartupSourceEvidence({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    connector,
    uri: options.uri,
    summary:
      options.summary ??
      `${definition.displayName} verification ${verification.status}`,
    status: verification.status,
    ...(options.capturedAt === undefined ? {} : { capturedAt: options.capturedAt }),
    ...(options.target === undefined ? {} : { target: options.target }),
    ...(options.freshnessDays === undefined
      ? {}
      : { freshnessDays: options.freshnessDays }),
    ...(options.sourceHash === undefined ? {} : { sourceHash: options.sourceHash }),
    ...(options.trustLevel === undefined ? {} : { trustLevel: options.trustLevel }),
    payload: JSON.stringify(payload),
    ...(options.goalId === undefined ? {} : { goalId: options.goalId }),
    ...(options.now === undefined ? {} : { now: options.now })
  });

  return {
    ...result,
    verification
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

export function parseStartupSourceTarget(value: string): StartupSourceTarget {
  if (value === "local" || value === "staging" || value === "production") {
    return value;
  }

  throw new Error(
    `Unsupported startup source target ${value}. Expected local, staging, or production`
  );
}

export function listStartupSourceConnectorDefinitions(): StartupSourceConnectorDefinition[] {
  return STARTUP_SOURCE_CONNECTOR_DEFINITIONS.map((definition) => ({
    ...definition,
    recommendedPayloadFields: [...definition.recommendedPayloadFields]
  }));
}

export function getStartupSourceConnectorDefinition(
  connector: StartupSourceConnector
): StartupSourceConnectorDefinition | undefined {
  const definition = STARTUP_SOURCE_CONNECTOR_DEFINITIONS.find(
    (candidate) => candidate.connector === connector
  );

  if (definition === undefined) {
    return undefined;
  }

  return {
    ...definition,
    recommendedPayloadFields: [...definition.recommendedPayloadFields]
  };
}

function requireStartupSourceConnectorDefinition(
  connector: StartupSourceConnector
): StartupSourceConnectorDefinition {
  const definition = getStartupSourceConnectorDefinition(connector);

  if (definition === undefined) {
    throw new Error(`Startup source connector definition not found: ${connector}`);
  }

  return definition;
}

function parseOptionalStartupSourceTarget(
  value: string | undefined
): StartupSourceTarget | undefined {
  return value === undefined ? undefined : parseStartupSourceTarget(value);
}

function startupSourceTargetEvidenceTiers(input: {
  connector: StartupSourceConnector;
  definition: StartupSourceConnectorDefinition;
  target: StartupSourceTarget | undefined;
}): string[] {
  if (input.target === undefined || input.target === "local") {
    return [];
  }

  const tiers = [];

  if (input.connector === "github_actions") {
    tiers.push("ci_verified");
  }

  if (startupSourceConnectorIsDeployment(input.connector, input.definition)) {
    tiers.push(
      input.target === "staging" ? "staging_deployment" : "production_deployment"
    );
  }

  if (
    input.target === "production" &&
    (input.connector === "analytics" ||
      input.connector === "posthog" ||
      input.connector === "billing")
  ) {
    tiers.push("real_user_analytics");
  }

  if (input.target === "production" && input.connector === "support") {
    tiers.push("support_ticket");
  }

  if (input.target === "production" && input.connector === "dependency") {
    tiers.push("security_scan");
  }

  return [...new Set(tiers)];
}

function startupSourceConnectorIsDeployment(
  connector: StartupSourceConnector,
  definition: StartupSourceConnectorDefinition
): boolean {
  return (
    connector === "deployment" ||
    connector === "vercel" ||
    connector === "fly" ||
    connector === "render" ||
    definition.sourceKind.endsWith("_deployment")
  );
}

function startupSourceEvidenceContent(input: {
  connector: StartupSourceConnector;
  definition: StartupSourceConnectorDefinition;
  status: string;
  target: StartupSourceTarget | undefined;
  sourceUri: string;
  sourceKind: string;
  qualityTier: EvidenceQualityTier;
  trustLevel: string;
  freshnessDays: number;
  readinessTiers: string[];
  readinessUse: string;
  payloadWarnings: string[];
  payload: JsonObject | undefined;
}): JsonObject {
  const common = {
    connector: input.connector,
    status: input.status,
    ...(input.target === undefined ? {} : { target: input.target }),
    sourceUri: input.sourceUri,
    sourceKind: input.sourceKind,
    qualityTier: input.qualityTier,
    readinessTiers: input.readinessTiers,
    trustLevel: input.trustLevel,
    freshnessDays: input.freshnessDays,
    readinessUse: input.readinessUse,
    payloadWarnings: input.payloadWarnings,
    ...(input.payload === undefined ? {} : { payload: input.payload })
  };

  if (input.definition.evidenceType !== "metric_snapshot") {
    return common;
  }

  return {
    metric:
      stringPayloadValue(input.payload, "metric") ?? `${input.connector}_source_metric`,
    source: input.definition.displayName,
    threshold:
      input.payload?.threshold ??
      stringPayloadValue(input.payload, "target") ??
      "recorded",
    current:
      input.payload?.current ??
      input.payload?.value ??
      input.payload?.count ??
      input.status,
    ...common
  };
}

function stringPayloadValue(
  payload: JsonObject | undefined,
  field: string
): string | undefined {
  const value = payload?.[field];

  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
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

async function readVerificationResponseText(
  response: StartupSourceVerificationResponse
): Promise<string> {
  if (response.text === undefined) {
    return "";
  }

  return response.text();
}

function boundedText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength)}...`;
}

function connectorDefinition(
  definition: StartupSourceConnectorDefinition
): StartupSourceConnectorDefinition {
  return definition;
}

function parseEvidenceSourceTrust(value: string): EvidenceSourceTrust {
  if (
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "authoritative"
  ) {
    return value;
  }

  throw new Error(
    `Unsupported source trust level ${value}. Expected low, medium, high, or authoritative`
  );
}

function connectorPayloadWarnings(
  definition: StartupSourceConnectorDefinition,
  payload: JsonObject | undefined
): string[] {
  if (payload === undefined) {
    return [
      `payload missing; recommended fields: ${definition.recommendedPayloadFields.join(", ")}`
    ];
  }

  return definition.recommendedPayloadFields
    .filter((field) => payload[field] === undefined)
    .map((field) => `payload missing recommended field: ${field}`);
}
