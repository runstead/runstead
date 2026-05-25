import type { EvidenceQualityTier, EvidenceSourceTrust } from "@runstead/evidence";

import type { StartupEvidenceType } from "./startup-evidence-types.js";

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

export interface StartupSourceProviderAdapter {
  connector: StartupSourceConnector;
  provider: "github" | "vercel" | "render" | "sentry" | "posthog";
  requiredTokenEnv?: string;
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

export function requireStartupSourceConnectorDefinition(
  connector: StartupSourceConnector
): StartupSourceConnectorDefinition {
  const definition = getStartupSourceConnectorDefinition(connector);

  if (definition === undefined) {
    throw new Error(`Startup source connector definition not found: ${connector}`);
  }

  return definition;
}

export function requireStartupSourceProviderAdapter(
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

function connectorDefinition(
  definition: StartupSourceConnectorDefinition
): StartupSourceConnectorDefinition {
  return definition;
}
