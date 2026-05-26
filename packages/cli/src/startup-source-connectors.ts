import type { JsonObject } from "@runstead/core";
import type { EvidenceQualityTier } from "@runstead/evidence";

import type {
  AddStartupEvidenceResult,
  StartupEvidenceType
} from "./startup-evidence.js";
import {
  parseStartupSourceConnector,
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
import { recordStartupSourceEvidence } from "./startup-source-evidence-recorder.js";

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
export { recordStartupSourceEvidence } from "./startup-source-evidence-recorder.js";

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

function adapterTokenFromEnv(
  adapter: StartupSourceProviderAdapter
): string | undefined {
  if (adapter.requiredTokenEnv === undefined) {
    return undefined;
  }

  const token = process.env[adapter.requiredTokenEnv];

  return token === undefined || token.trim().length === 0 ? undefined : token;
}
