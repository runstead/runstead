import type { JsonObject } from "@runstead/core";
import {
  defineEvidenceSource,
  type EvidenceQualityTier,
  type EvidenceSourceTrust
} from "@runstead/evidence";
import type { ReadinessEvidenceRequirement } from "@runstead/runtime";

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

export interface CollectStartupSourceEvidenceOptions {
  cwd?: string;
  connector: string;
  uri: string;
  target?: string;
  token?: string;
  capturedAt?: string;
  freshnessDays?: number;
  sourceHash?: string;
  trustLevel?: string;
  goalId?: string;
  fetch?: StartupSourceVerificationFetch;
  now?: Date;
}

export interface CollectStartupSourceEvidenceResult extends RecordStartupSourceEvidenceResult {
  adapter: StartupSourceProviderAdapter;
  collection: StartupSourceProviderCollection;
}

export interface StartupSourceProviderAdapter {
  connector: StartupSourceConnector;
  provider: "github" | "vercel" | "render" | "sentry" | "posthog";
  requiredTokenEnv?: string;
}

export interface StartupSourceProviderCollection {
  status: "passed" | "failed" | "unknown";
  summary: string;
  payload: JsonObject;
}

interface ConnectorResponseJsonParseResult {
  payload: JsonObject;
  parseError?: string;
  responseExcerpt?: string;
}

export interface StartupSourceConnectorReadinessRequirement {
  id: string;
  title: string;
  target: StartupSourceTarget;
  connectors: StartupSourceConnector[];
  evidenceTiers: string[];
  evidenceTypes: string[];
  requiredTokenEnv: string[];
  missingTokenEnv: string[];
  blockers: string[];
  collectCommands: string[];
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

const STARTUP_SOURCE_PROVIDER_ADAPTERS: StartupSourceProviderAdapter[] = [
  {
    connector: "github_actions",
    provider: "github",
    requiredTokenEnv: "GITHUB_TOKEN"
  },
  {
    connector: "vercel",
    provider: "vercel",
    requiredTokenEnv: "VERCEL_TOKEN"
  },
  {
    connector: "render",
    provider: "render",
    requiredTokenEnv: "RENDER_API_KEY"
  },
  {
    connector: "sentry",
    provider: "sentry",
    requiredTokenEnv: "SENTRY_AUTH_TOKEN"
  },
  {
    connector: "posthog",
    provider: "posthog",
    requiredTokenEnv: "POSTHOG_API_KEY"
  }
];

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

export async function collectStartupSourceEvidence(
  options: CollectStartupSourceEvidenceOptions
): Promise<CollectStartupSourceEvidenceResult> {
  const connector = parseStartupSourceConnector(options.connector);
  const adapter = requireStartupSourceProviderAdapter(connector);
  const definition = requireStartupSourceConnectorDefinition(connector);
  const fetcher = options.fetch ?? globalThis.fetch;

  if (fetcher === undefined) {
    throw new Error("fetch API is unavailable; provide a fetch implementation");
  }

  const token = options.token ?? adapterTokenFromEnv(adapter);
  const response = await fetcher(options.uri, {
    method: "GET",
    signal: AbortSignal.timeout(10_000),
    ...(token === undefined ? {} : { headers: providerAuthHeaders(adapter, token) })
  });
  const responseText = await readVerificationResponseText(response);
  const parsedResponse = parseConnectorResponseJson(responseText, {
    secrets: token === undefined ? [] : [token]
  });
  const collection = collectProviderPayload({
    adapter,
    definition,
    responseStatus: response.status,
    responseOk: response.ok,
    responsePayload: parsedResponse.payload,
    ...(parsedResponse.parseError === undefined
      ? {}
      : { parseError: parsedResponse.parseError }),
    ...(parsedResponse.responseExcerpt === undefined
      ? {}
      : { responseExcerpt: parsedResponse.responseExcerpt })
  });
  const result = await recordStartupSourceEvidence({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    connector,
    uri: options.uri,
    summary: collection.summary,
    status: collection.status,
    ...(options.capturedAt === undefined ? {} : { capturedAt: options.capturedAt }),
    ...(options.target === undefined ? {} : { target: options.target }),
    ...(options.freshnessDays === undefined
      ? {}
      : { freshnessDays: options.freshnessDays }),
    ...(options.sourceHash === undefined ? {} : { sourceHash: options.sourceHash }),
    ...(options.trustLevel === undefined ? {} : { trustLevel: options.trustLevel }),
    payload: JSON.stringify(collection.payload),
    ...(options.goalId === undefined ? {} : { goalId: options.goalId }),
    ...(options.now === undefined ? {} : { now: options.now })
  });

  return {
    ...result,
    adapter,
    collection
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

export function getStartupSourceProviderAdapter(
  connector: StartupSourceConnector
): StartupSourceProviderAdapter | undefined {
  return STARTUP_SOURCE_PROVIDER_ADAPTERS.find(
    (candidate) => candidate.connector === connector
  );
}

export function startupSourceConnectorRequirementsForTarget(options: {
  target: StartupSourceTarget;
  env?: Record<string, string | undefined>;
}): StartupSourceConnectorReadinessRequirement[] {
  if (options.target === "local") {
    return [];
  }

  const env = options.env ?? process.env;
  const requirements = [
    sourceConnectorRequirement({
      id: "remote-ci",
      title: "Remote CI status",
      target: options.target,
      connectors: ["github_actions"],
      evidenceTiers: ["ci_verified"],
      evidenceTypes: ["startup_repo_readiness"],
      requiredTokenEnv: ["GITHUB_TOKEN"],
      env
    }),
    sourceConnectorRequirement({
      id: "deployment-provider",
      title: `${options.target} deployment provider`,
      target: options.target,
      connectors: ["vercel", "render"],
      evidenceTiers: [
        options.target === "staging" ? "staging_deployment" : "production_deployment"
      ],
      evidenceTypes: ["startup_release_plan"],
      requiredTokenEnv: ["VERCEL_TOKEN", "RENDER_API_KEY"],
      tokenMode: "any",
      env
    }),
    sourceConnectorRequirement({
      id: "monitoring-provider",
      title: "Monitoring provider",
      target: options.target,
      connectors: ["sentry"],
      evidenceTiers: [],
      evidenceTypes: ["startup_monitoring_alerts"],
      requiredTokenEnv: ["SENTRY_AUTH_TOKEN"],
      env
    }),
    ...(options.target === "production"
      ? [
          sourceConnectorRequirement({
            id: "analytics-provider",
            title: "Real-user analytics provider",
            target: options.target,
            connectors: ["posthog"],
            evidenceTiers: ["real_user_analytics"],
            evidenceTypes: ["startup_metric_snapshot"],
            requiredTokenEnv: ["POSTHOG_API_KEY"],
            env
          })
        ]
      : [])
  ];

  return requirements;
}

export function startupSourceConnectorReadinessEvidenceRequirements(
  requirements: StartupSourceConnectorReadinessRequirement[]
): ReadinessEvidenceRequirement[] {
  return requirements.map((requirement) => ({
    source: "startup_source",
    sourceId: requirement.id,
    targets: [requirement.target],
    evidenceTiers: [...requirement.evidenceTiers],
    evidenceTypes: [...requirement.evidenceTypes],
    ...(requirement.blockers.length === 0
      ? {}
      : { blockers: [...requirement.blockers] })
  }));
}

export function startupSourceConnectorRequirementBlockers(
  requirements: StartupSourceConnectorReadinessRequirement[]
): string[] {
  return requirements.flatMap((requirement) => requirement.blockers);
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

function requireStartupSourceProviderAdapter(
  connector: StartupSourceConnector
): StartupSourceProviderAdapter {
  const adapter = getStartupSourceProviderAdapter(connector);

  if (adapter === undefined) {
    throw new Error(
      `Startup source connector ${connector} does not have an executable adapter`
    );
  }

  return adapter;
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

function sourceConnectorRequirement(input: {
  id: string;
  title: string;
  target: StartupSourceTarget;
  connectors: StartupSourceConnector[];
  evidenceTiers: string[];
  evidenceTypes: string[];
  requiredTokenEnv: string[];
  tokenMode?: "all" | "any";
  env: Record<string, string | undefined>;
}): StartupSourceConnectorReadinessRequirement {
  const tokenMode = input.tokenMode ?? "all";
  const missingTokenEnv =
    tokenMode === "any"
      ? input.requiredTokenEnv.some((name) => envValuePresent(input.env, name))
        ? []
        : [...input.requiredTokenEnv]
      : input.requiredTokenEnv.filter((name) => !envValuePresent(input.env, name));
  const tokenDescription =
    tokenMode === "any"
      ? `one of ${input.requiredTokenEnv.join(", ")}`
      : input.requiredTokenEnv.join(", ");
  const blockers =
    missingTokenEnv.length === 0
      ? []
      : [
          `${input.title} connector requires ${tokenDescription} for ${input.target} readiness`
        ];

  return {
    id: input.id,
    title: input.title,
    target: input.target,
    connectors: [...input.connectors],
    evidenceTiers: [...input.evidenceTiers],
    evidenceTypes: [...input.evidenceTypes],
    requiredTokenEnv: [...input.requiredTokenEnv],
    missingTokenEnv,
    blockers,
    collectCommands: input.connectors.map(
      (connector) =>
        `runstead startup source collect --connector ${connector} --target ${input.target} --source-uri <provider-api-url>`
    )
  };
}

function envValuePresent(
  env: Record<string, string | undefined>,
  name: string
): boolean {
  return env[name] !== undefined && env[name]?.trim() !== "";
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

function parseConnectorResponseJson(
  value: string,
  options?: {
    secrets?: string[];
  }
): ConnectorResponseJsonParseResult {
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
          boundedText(value, 2_000),
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
      responseExcerpt: redactSecrets(boundedText(value, 2_000), options?.secrets ?? [])
    };
  }
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

function adapterTokenFromEnv(
  adapter: StartupSourceProviderAdapter
): string | undefined {
  if (adapter.requiredTokenEnv === undefined) {
    return undefined;
  }

  const token = process.env[adapter.requiredTokenEnv];

  return token === undefined || token.trim().length === 0 ? undefined : token;
}

function providerAuthHeaders(
  adapter: StartupSourceProviderAdapter,
  token: string
): Record<string, string> {
  switch (adapter.provider) {
    case "github":
      return {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json"
      };
    case "sentry":
    case "posthog":
    case "vercel":
    case "render":
      return {
        Authorization: `Bearer ${token}`
      };
  }
}

function collectProviderPayload(input: {
  adapter: StartupSourceProviderAdapter;
  definition: StartupSourceConnectorDefinition;
  responseStatus: number;
  responseOk: boolean;
  responsePayload: JsonObject;
  parseError?: string;
  responseExcerpt?: string;
}): StartupSourceProviderCollection {
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

function collectGithubActionsPayload(
  payload: JsonObject
): StartupSourceProviderCollection {
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
  const collectionStatus: StartupSourceProviderCollection["status"] = passed
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
  connector: StartupSourceConnector;
  displayName: string;
  readyStates: string[];
  payload: JsonObject;
}): StartupSourceProviderCollection {
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
  const collectionStatus: StartupSourceProviderCollection["status"] = passed
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

function collectSentryPayload(payload: JsonObject): StartupSourceProviderCollection {
  const blockers =
    numberPayloadValue(payload, "openReleaseBlockers") ??
    numberPayloadValue(payload, "issueCount") ??
    arrayPayloadLength(payload, "issues");
  const status: StartupSourceProviderCollection["status"] =
    blockers === undefined ? "unknown" : blockers === 0 ? "passed" : "failed";
  const blockerSummary = blockers === undefined ? "unknown" : String(blockers);

  return {
    status,
    summary: `Sentry release blockers: ${blockerSummary}`,
    payload: {
      openReleaseBlockers: blockers ?? "unknown",
      release: stringPayloadValue(payload, "release") ?? "unknown",
      project: stringPayloadValue(payload, "project") ?? "unknown"
    }
  };
}

function collectPosthogPayload(payload: JsonObject): StartupSourceProviderCollection {
  const value = numberPayloadValue(payload, "value");
  const threshold = numberPayloadValue(payload, "threshold");
  const realUserData = Boolean(payload.realUserData);
  const passed =
    value !== undefined &&
    realUserData &&
    (threshold === undefined || value >= threshold);
  const status: StartupSourceProviderCollection["status"] =
    value === undefined ? "unknown" : passed ? "passed" : "failed";

  return {
    status,
    summary: `PostHog metric ${stringPayloadValue(payload, "metric") ?? "activation"} value ${value ?? "unknown"}`,
    payload: {
      metric: stringPayloadValue(payload, "metric") ?? "activation",
      value: value ?? "unknown",
      ...(threshold === undefined ? {} : { threshold }),
      window: stringPayloadValue(payload, "window") ?? "unknown",
      realUserData
    }
  };
}

function normalizeProviderState(value: string | undefined): string | undefined {
  return value?.trim().toLowerCase();
}

function numberPayloadValue(payload: JsonObject, field: string): number | undefined {
  const value = payload[field];

  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
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
  return /(?:authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|bearer)/i.test(
    key
  );
}

function redactSecrets(value: string, secrets: string[]): string {
  return secrets
    .filter((secret) => secret.trim().length > 0)
    .reduce((redacted, secret) => redacted.split(secret).join("[redacted]"), value);
}
