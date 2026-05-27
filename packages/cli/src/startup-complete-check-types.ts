import type { RunsteadEvent } from "@runstead/core";
import type {
  RuntimeCompleteProductCriterion,
  RuntimeCompleteProductCriterionStatus,
  RuntimeCompleteProductStatus
} from "@runstead/runtime";

import type { LaunchReadinessTarget } from "./launch-readiness-report.js";
import type { StartupGateFindingSeverity } from "./startup-evidence.js";

export interface GenerateStartupCompleteProductCheckOptions {
  cwd?: string;
  domain?: string;
  target?: LaunchReadinessTarget;
  readiness?: {
    verdict: string;
    blockers: string[];
  };
  now?: Date;
}

export interface StartupCompleteProductCheckResult {
  root: string;
  stateDb: string;
  domain: string;
  generatedAt: string;
  status: StartupCompleteProductStatus;
  score: number;
  markdownPath: string;
  jsonPath: string;
  markdown: string;
  event: RunsteadEvent;
  evidenceId: string;
  criteria: StartupCompleteProductCriterion[];
  blockers: StartupCompleteProductBlockerAudit[];
  surfaces: StartupCompleteProductSurfaces;
}

export type StartupCompleteProductStatus = RuntimeCompleteProductStatus;
export type StartupCompleteProductCriterionStatus =
  RuntimeCompleteProductCriterionStatus;
export type StartupCompleteProductCriterion = RuntimeCompleteProductCriterion;

export interface StartupCompleteProductBlockerAudit {
  blocker: string;
  severity: StartupGateFindingSeverity;
  owner: string;
  remediationTask: string;
  evidenceSources: string[];
}

export interface StartupCompleteProductSurfaces {
  launchReportMarkdown: string;
  launchReportJson: string;
  ciMarkdown: string;
  ciJson: string;
  dashboardHtml: string;
  dashboardJson: string;
  diagnosticsMarkdown: string;
  diagnosticsJson: string;
  completeCheckMarkdown: string;
  completeCheckJson: string;
  evidenceId: string;
  eventId: string;
}
