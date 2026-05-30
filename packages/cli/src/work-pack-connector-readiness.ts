import {
  listRunsteadConnectors,
  type RunsteadConnectorDefinition,
  type RunsteadConnectorId,
  type RunsteadConnectorMaturity
} from "./connector-catalog.js";

export type WorkPackConnectorReadinessStatus =
  | "ready"
  | "missing_credentials"
  | "catalog_only";

export interface WorkPackConnectorReadiness {
  connector: RunsteadConnectorId;
  maturity: RunsteadConnectorMaturity;
  status: WorkPackConnectorReadinessStatus;
  credentialEnv: string[];
  missingCredentialEnv: string[];
  evidenceTypes: string[];
  reason: string;
}

export function evaluateWorkPackConnectorReadiness(input: {
  domain: string;
  evidenceRequirements?: string[];
  env?: Record<string, string | undefined>;
}): WorkPackConnectorReadiness[] {
  const env = input.env ?? process.env;
  const requirementSet = new Set(input.evidenceRequirements ?? []);

  return listRunsteadConnectors()
    .filter((connector) => connector.supportedDomains.includes(input.domain))
    .filter(
      (connector) =>
        requirementSet.size === 0 ||
        connector.evidenceTypes.some((type) => requirementSet.has(type))
    )
    .map((connector) => connectorReadiness(connector, env));
}

function connectorReadiness(
  connector: RunsteadConnectorDefinition,
  env: Record<string, string | undefined>
): WorkPackConnectorReadiness {
  const missingCredentialEnv = connector.credentialEnv.filter(
    (name) => !hasCredential(env[name])
  );

  if (connector.maturity === "catalog") {
    return {
      connector: connector.id,
      maturity: connector.maturity,
      status: "catalog_only",
      credentialEnv: [...connector.credentialEnv],
      missingCredentialEnv,
      evidenceTypes: [...connector.evidenceTypes],
      reason: "connector contract exists, but no executable adapter is registered"
    };
  }

  if (missingCredentialEnv.length > 0) {
    return {
      connector: connector.id,
      maturity: connector.maturity,
      status: "missing_credentials",
      credentialEnv: [...connector.credentialEnv],
      missingCredentialEnv,
      evidenceTypes: [...connector.evidenceTypes],
      reason: `missing credential env ${missingCredentialEnv.join(", ")}`
    };
  }

  return {
    connector: connector.id,
    maturity: connector.maturity,
    status: "ready",
    credentialEnv: [...connector.credentialEnv],
    missingCredentialEnv: [],
    evidenceTypes: [...connector.evidenceTypes],
    reason: "connector adapter and credentials are available"
  };
}

function hasCredential(value: string | undefined): boolean {
  return value !== undefined && value.trim().length > 0;
}
