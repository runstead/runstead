import type { JsonObject } from "@runstead/core";
import type { EvidenceQualityTier, EvidenceSourceTrust } from "@runstead/evidence";

import type {
  StartupSourceConnector,
  StartupSourceConnectorDefinition,
  StartupSourceTarget
} from "./startup-source-connector-definitions.js";

export function startupSourceTargetEvidenceTiers(input: {
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

export function startupSourceEvidenceContent(input: {
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

export function connectorPayload(payload: string | undefined): JsonObject | undefined {
  if (payload === undefined || payload.trim().length === 0) {
    return undefined;
  }

  const parsed = JSON.parse(payload) as unknown;

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("--payload must be a JSON object");
  }

  return parsed as JsonObject;
}

export function parseEvidenceSourceTrust(value: string): EvidenceSourceTrust {
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

export function connectorPayloadWarnings(
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

function stringPayloadValue(
  payload: JsonObject | undefined,
  field: string
): string | undefined {
  const value = payload?.[field];

  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}
