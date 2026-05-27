import {
  parseStartupSourceConnector,
  requireStartupSourceConnectorDefinition,
  requireStartupSourceProviderAdapter,
  type StartupSourceProviderAdapter
} from "./startup-source-connector-definitions.js";
import {
  collectStartupSourceProviderPayload,
  parseStartupSourceConnectorResponseJson,
  startupSourceProviderAuthHeaders
} from "./startup-source-provider-payload.js";
import { recordStartupSourceEvidence } from "./startup-source-evidence-recorder.js";
import type {
  CollectStartupSourceEvidenceOptions,
  CollectStartupSourceEvidenceResult,
  StartupSourceVerificationResponse
} from "./startup-source-evidence-types.js";

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
export { verifyStartupSourceEvidence } from "./startup-source-verification.js";
export type {
  CollectStartupSourceEvidenceOptions,
  CollectStartupSourceEvidenceResult,
  RecordStartupSourceEvidenceOptions,
  RecordStartupSourceEvidenceResult,
  StartupSourceVerificationFetch,
  StartupSourceVerificationResponse,
  StartupSourceVerificationResult,
  StartupSourceVerificationTextCheck,
  VerifyStartupSourceEvidenceOptions,
  VerifyStartupSourceEvidenceResult
} from "./startup-source-evidence-types.js";

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

function adapterTokenFromEnv(
  adapter: StartupSourceProviderAdapter
): string | undefined {
  if (adapter.requiredTokenEnv === undefined) {
    return undefined;
  }

  const token = process.env[adapter.requiredTokenEnv];

  return token === undefined || token.trim().length === 0 ? undefined : token;
}
