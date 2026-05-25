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
import {
  parseStartupSourceConnector,
  parseStartupSourceTarget,
  requireStartupSourceConnectorDefinition,
  requireStartupSourceProviderAdapter,
  type StartupSourceConnector,
  type StartupSourceConnectorDefinition,
  type StartupSourceProviderAdapter,
  type StartupSourceTarget
} from "./startup-source-connector-definitions.js";
import {
  collectStartupSourceProviderPayload,
  parseStartupSourceConnectorResponseJson,
  startupSourceProviderAuthHeaders,
  type StartupSourceProviderCollection
} from "./startup-source-provider-payload.js";

export {
  STARTUP_SOURCE_CONNECTORS,
  getStartupSourceConnectorDefinition,
  getStartupSourceProviderAdapter,
  listStartupSourceConnectorDefinitions,
  parseStartupSourceConnector,
  parseStartupSourceTarget
} from "./startup-source-connector-definitions.js";
export type {
  StartupSourceConnector,
  StartupSourceConnectorDefinition,
  StartupSourceProviderAdapter,
  StartupSourceTarget
} from "./startup-source-connector-definitions.js";
export type { StartupSourceProviderCollection } from "./startup-source-provider-payload.js";
export {
  startupSourceConnectorReadinessEvidenceRequirements,
  startupSourceConnectorRequirementBlockers,
  startupSourceConnectorRequirementsForTarget
} from "./startup-source-readiness-requirements.js";
export type { StartupSourceConnectorReadinessRequirement } from "./startup-source-readiness-requirements.js";

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
    ...(token === undefined
      ? {}
      : { headers: startupSourceProviderAuthHeaders(adapter, token) })
  });
  const responseText = await readVerificationResponseText(response);
  const parsedResponse = parseStartupSourceConnectorResponseJson(responseText, {
    secrets: token === undefined ? [] : [token]
  });
  const collection = collectStartupSourceProviderPayload({
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
