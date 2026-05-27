import type { JsonObject } from "@runstead/core";

import {
  parseStartupSourceConnector,
  requireStartupSourceConnectorDefinition
} from "./startup-source-connector-definitions.js";
import { recordStartupSourceEvidence } from "./startup-source-evidence-recorder.js";
import type {
  StartupSourceVerificationResponse,
  StartupSourceVerificationResult,
  VerifyStartupSourceEvidenceOptions,
  VerifyStartupSourceEvidenceResult
} from "./startup-source-evidence-types.js";

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
