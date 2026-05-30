import type { StartupSourceConnector } from "./startup-source-connector-definitions.js";

export const RUNSTEAD_CONNECTOR_IDS = [
  "github",
  "vercel",
  "sentry",
  "posthog",
  "email",
  "web",
  "docs"
] as const;

export type RunsteadConnectorId = (typeof RUNSTEAD_CONNECTOR_IDS)[number];
export type RunsteadConnectorMaturity = "executable" | "catalog";

export interface RunsteadConnectorDefinition {
  id: RunsteadConnectorId;
  displayName: string;
  category: string;
  summary: string;
  credentialEnv: string[];
  reads: string[];
  writes: string[];
  evidenceTypes: string[];
  supportedDomains: string[];
  startupSourceConnectors: StartupSourceConnector[];
  maturity: RunsteadConnectorMaturity;
}

const RUNSTEAD_CONNECTOR_CATALOG: RunsteadConnectorDefinition[] = [
  {
    id: "github",
    displayName: "GitHub",
    category: "code_hosting",
    summary: "Repository, workflow, pull request, issue, and release signals.",
    credentialEnv: ["GITHUB_TOKEN"],
    reads: ["repository", "branch", "pull_request", "issue", "workflow_run"],
    writes: ["pull_request_comment", "issue_comment"],
    evidenceTypes: [
      "repo_readiness",
      "repo_inspection",
      "github_workflow_run",
      "decision",
      "support_triage"
    ],
    supportedDomains: ["repo-maintenance", "ai-native-startup"],
    startupSourceConnectors: ["github_actions", "github_pr", "github_issue"],
    maturity: "executable"
  },
  {
    id: "vercel",
    displayName: "Vercel",
    category: "deployment",
    summary: "Deployment status, preview URLs, production rollout, and logs.",
    credentialEnv: ["VERCEL_TOKEN"],
    reads: ["deployment", "project", "environment"],
    writes: [],
    evidenceTypes: ["deployment", "startup_repo_readiness"],
    supportedDomains: ["ai-native-startup"],
    startupSourceConnectors: ["vercel"],
    maturity: "executable"
  },
  {
    id: "sentry",
    displayName: "Sentry",
    category: "observability",
    summary: "Release health, error events, issue trends, and alert context.",
    credentialEnv: ["SENTRY_AUTH_TOKEN"],
    reads: ["release", "issue", "error_event", "project"],
    writes: [],
    evidenceTypes: ["startup_security_baseline", "startup_repo_readiness"],
    supportedDomains: ["ai-native-startup"],
    startupSourceConnectors: ["sentry"],
    maturity: "executable"
  },
  {
    id: "posthog",
    displayName: "PostHog",
    category: "analytics",
    summary: "Activation, retention, funnels, cohorts, and product analytics.",
    credentialEnv: ["POSTHOG_API_KEY"],
    reads: ["insight", "event", "cohort", "funnel", "retention"],
    writes: [],
    evidenceTypes: ["startup_measurement_framework", "startup_metric_snapshot"],
    supportedDomains: ["ai-native-startup"],
    startupSourceConnectors: ["posthog"],
    maturity: "executable"
  },
  {
    id: "email",
    displayName: "Email",
    category: "communication",
    summary:
      "Mailbox threads, contacts, safe draft creation, and send boundary evidence.",
    credentialEnv: ["EMAIL_READ_TOKEN"],
    reads: ["mailbox", "email_thread", "contact"],
    writes: ["draft"],
    evidenceTypes: ["thread_inventory", "recipient_review", "draft_preview"],
    supportedDomains: ["email-followup"],
    startupSourceConnectors: [],
    maturity: "catalog"
  },
  {
    id: "web",
    displayName: "Web",
    category: "research",
    summary: "Web pages, PDFs, search results, citation sources, and retrieval logs.",
    credentialEnv: [],
    reads: ["webpage", "pdf", "search_result", "citation_source"],
    writes: ["retrieval_log"],
    evidenceTypes: ["source_inventory", "retrieval_log", "citation_ledger"],
    supportedDomains: ["research-monitor"],
    startupSourceConnectors: [],
    maturity: "catalog"
  },
  {
    id: "docs",
    displayName: "Docs",
    category: "knowledge",
    summary: "Workspace documentation, institutional memory, and source references.",
    credentialEnv: ["DOCS_API_TOKEN"],
    reads: ["workspace_doc", "knowledge_base", "runbook"],
    writes: ["draft_doc_update"],
    evidenceTypes: ["institutional_memory", "source_inventory", "archive_record"],
    supportedDomains: ["ai-native-startup", "research-monitor"],
    startupSourceConnectors: ["docs"],
    maturity: "executable"
  }
];

export function listRunsteadConnectors(): RunsteadConnectorDefinition[] {
  return RUNSTEAD_CONNECTOR_CATALOG.map(cloneRunsteadConnector);
}

export function getRunsteadConnector(
  id: string
): RunsteadConnectorDefinition | undefined {
  const connector = RUNSTEAD_CONNECTOR_CATALOG.find((candidate) => candidate.id === id);

  return connector === undefined ? undefined : cloneRunsteadConnector(connector);
}

export function requireRunsteadConnector(id: string): RunsteadConnectorDefinition {
  const connector = getRunsteadConnector(id);

  if (connector === undefined) {
    throw new Error(
      `Connector not found: ${id}. Expected one of: ${RUNSTEAD_CONNECTOR_IDS.join(", ")}`
    );
  }

  return connector;
}

export function formatRunsteadConnectorList(
  connectors = listRunsteadConnectors()
): string {
  return [
    "Runstead connectors",
    ...connectors.map(
      (connector) =>
        `${connector.id.padEnd(8)} ${connector.category.padEnd(14)} ${connector.maturity.padEnd(10)} ${connector.displayName}`
    )
  ].join("\n");
}

export function formatRunsteadConnector(
  connector: RunsteadConnectorDefinition
): string {
  return [
    `Connector: ${connector.id}`,
    `Name: ${connector.displayName}`,
    `Category: ${connector.category}`,
    `Maturity: ${connector.maturity}`,
    `Summary: ${connector.summary}`,
    `Credentials: ${formatList(connector.credentialEnv)}`,
    `Reads: ${formatList(connector.reads)}`,
    `Writes: ${formatList(connector.writes)}`,
    `Evidence types: ${formatList(connector.evidenceTypes)}`,
    `Supported domains: ${formatList(connector.supportedDomains)}`,
    `Startup source connectors: ${formatList(connector.startupSourceConnectors)}`
  ].join("\n");
}

function cloneRunsteadConnector(
  connector: RunsteadConnectorDefinition
): RunsteadConnectorDefinition {
  return {
    ...connector,
    credentialEnv: [...connector.credentialEnv],
    reads: [...connector.reads],
    writes: [...connector.writes],
    evidenceTypes: [...connector.evidenceTypes],
    supportedDomains: [...connector.supportedDomains],
    startupSourceConnectors: [...connector.startupSourceConnectors]
  };
}

function formatList(values: string[]): string {
  if (values.length === 0) {
    return "0";
  }

  return `${values.length} (${values.join(", ")})`;
}
