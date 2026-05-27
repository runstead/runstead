import { defineEvidenceSource } from "@runstead/evidence";

import { addStartupEvidence } from "./startup-evidence.js";
import {
  parseStartupSourceConnector,
  parseStartupSourceTarget,
  requireStartupSourceConnectorDefinition,
  type StartupSourceTarget
} from "./startup-source-connector-definitions.js";
import {
  connectorPayload,
  connectorPayloadWarnings,
  parseEvidenceSourceTrust,
  startupSourceEvidenceContent,
  startupSourceReadinessTiersForStatus,
  startupSourceTargetEvidenceTiers
} from "./startup-source-evidence-content.js";
import type {
  RecordStartupSourceEvidenceOptions,
  RecordStartupSourceEvidenceResult
} from "./startup-source-evidence-types.js";

export async function recordStartupSourceEvidence(
  options: RecordStartupSourceEvidenceOptions
): Promise<RecordStartupSourceEvidenceResult> {
  const connector = parseStartupSourceConnector(options.connector);
  const definition = requireStartupSourceConnectorDefinition(connector);
  const evidenceType = definition.evidenceType;
  const target = parseOptionalStartupSourceTarget(options.target);
  const payload = connectorPayload(options.payload);
  const payloadWarnings = connectorPayloadWarnings(definition, payload);
  const status = options.status ?? "recorded";
  const targetReadinessTiers = startupSourceTargetEvidenceTiers({
    connector,
    definition,
    target
  });
  const readinessTiers = startupSourceReadinessTiersForStatus({
    status,
    readinessTiers: targetReadinessTiers
  });
  const content = startupSourceEvidenceContent({
    connector,
    definition,
    status,
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

function parseOptionalStartupSourceTarget(
  value: string | undefined
): StartupSourceTarget | undefined {
  return value === undefined ? undefined : parseStartupSourceTarget(value);
}
