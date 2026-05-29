import type { EvidenceQualityTier, EvidenceSourceTrust } from "@runstead/evidence";
import type { RuntimeSourceProviderKind } from "@runstead/runtime";

import type { StartupEvidenceType } from "./startup-evidence-types.js";

export const STARTUP_SOURCE_CONNECTORS = [
  "github_actions",
  "gitlab_ci",
  "ci",
  "github_pr",
  "gitlab_merge_request",
  "github_issue",
  "linear",
  "jira",
  "slack",
  "docs",
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
  provider: RuntimeSourceProviderKind;
  requiredTokenEnv?: string;
}

export const STARTUP_SOURCE_PROVIDER_ADAPTERS: StartupSourceProviderAdapter[] = [
  {
    connector: "github_actions",
    provider: "github",
    requiredTokenEnv: "GITHUB_TOKEN"
  },
  {
    connector: "gitlab_ci",
    provider: "gitlab",
    requiredTokenEnv: "GITLAB_TOKEN"
  },
  {
    connector: "gitlab_merge_request",
    provider: "gitlab",
    requiredTokenEnv: "GITLAB_TOKEN"
  },
  {
    connector: "linear",
    provider: "linear",
    requiredTokenEnv: "LINEAR_API_KEY"
  },
  {
    connector: "jira",
    provider: "jira",
    requiredTokenEnv: "JIRA_API_TOKEN"
  },
  {
    connector: "slack",
    provider: "slack",
    requiredTokenEnv: "SLACK_BOT_TOKEN"
  },
  {
    connector: "docs",
    provider: "docs",
    requiredTokenEnv: "DOCS_API_TOKEN"
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

export const STARTUP_SOURCE_CONNECTOR_DEFINITIONS: StartupSourceConnectorDefinition[] =
  [
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
      connector: "gitlab_ci",
      displayName: "GitLab CI",
      evidenceType: "repo_readiness",
      sourceKind: "gitlab_ci",
      qualityTier: "external_observed",
      defaultTrustLevel: "authoritative",
      defaultFreshnessDays: 7,
      recommendedPayloadFields: ["pipeline", "status", "ref", "sha"],
      readinessUse: "GitLab CI and remote verifier evidence"
    }),
    connectorDefinition({
      connector: "ci",
      displayName: "CI Run",
      evidenceType: "repo_readiness",
      sourceKind: "ci_run",
      qualityTier: "external_observed",
      defaultTrustLevel: "high",
      defaultFreshnessDays: 7,
      recommendedPayloadFields: ["system", "status", "conclusion", "sha"],
      readinessUse: "Generic remote CI evidence"
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
      connector: "gitlab_merge_request",
      displayName: "GitLab Merge Request",
      evidenceType: "decision",
      sourceKind: "gitlab_merge_request",
      qualityTier: "external_observed",
      defaultTrustLevel: "high",
      defaultFreshnessDays: 14,
      recommendedPayloadFields: ["iid", "state", "merged", "approvedBy"],
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
      connector: "linear",
      displayName: "Linear",
      evidenceType: "team_collaboration",
      sourceKind: "linear_issue",
      qualityTier: "external_observed",
      defaultTrustLevel: "medium",
      defaultFreshnessDays: 14,
      recommendedPayloadFields: ["issueId", "state", "team", "labels"],
      readinessUse: "planning, triage, and workflow evidence"
    }),
    connectorDefinition({
      connector: "jira",
      displayName: "Jira",
      evidenceType: "team_collaboration",
      sourceKind: "jira_issue",
      qualityTier: "external_observed",
      defaultTrustLevel: "medium",
      defaultFreshnessDays: 14,
      recommendedPayloadFields: ["issueKey", "status", "project", "labels"],
      readinessUse: "planning, triage, and workflow evidence"
    }),
    connectorDefinition({
      connector: "slack",
      displayName: "Slack",
      evidenceType: "team_collaboration",
      sourceKind: "slack_thread",
      qualityTier: "external_observed",
      defaultTrustLevel: "medium",
      defaultFreshnessDays: 14,
      recommendedPayloadFields: ["channel", "threadTs", "participants", "decision"],
      readinessUse: "team discussion, decision, and handoff evidence"
    }),
    connectorDefinition({
      connector: "docs",
      displayName: "Workspace Docs",
      evidenceType: "institutional_memory",
      sourceKind: "workspace_doc",
      qualityTier: "external_observed",
      defaultTrustLevel: "medium",
      defaultFreshnessDays: 30,
      recommendedPayloadFields: ["document", "title", "updatedAt", "url"],
      readinessUse: "workspace documentation and institutional memory evidence"
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

function connectorDefinition(
  definition: StartupSourceConnectorDefinition
): StartupSourceConnectorDefinition {
  return definition;
}
