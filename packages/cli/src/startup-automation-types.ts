import type { Goal, Task } from "@runstead/core";

import type { InitPolicyProfile } from "./init.js";

export type StartupInitStage = "mvp" | "launch" | "scale";

export interface StartupInitOptions {
  cwd?: string;
  stage?: StartupInitStage;
  profile?: InitPolicyProfile;
  force?: boolean;
  now?: Date;
}

export interface StartupInitResult {
  root: string;
  stateDb: string;
  stage: StartupInitStage;
  domainInstalled: boolean;
  domainUpgraded: boolean;
  goalCreated: boolean;
  goal: Goal;
  generatedTasks: Task[];
}

export interface GenerateStartupContextOptions {
  cwd?: string;
  force?: boolean;
  currentOnly?: boolean;
  writeTrackedContext?: boolean;
  architecturePrinciples?: string[];
  technicalConstraints?: string[];
  acceptedDebt?: string[];
  now?: Date;
}

export interface GenerateStartupContextResult {
  root: string;
  stateDb: string;
  files: string[];
  structuredFiles: string[];
  evidenceId: string;
}

export interface GenerateMeasurementFrameworkOptions {
  cwd?: string;
  force?: boolean;
  writeTrackedContext?: boolean;
  activationMetric?: string;
  retentionMetric?: string;
  day7Metric?: string;
  day30Metric?: string;
  falsePositiveMetric?: string;
  now?: Date;
}

export interface GenerateMeasurementFrameworkResult {
  root: string;
  stateDb: string;
  files: string[];
  structuredFiles: string[];
  evidenceId: string;
}

export interface GenerateRepoReadinessAuditOptions {
  cwd?: string;
  now?: Date;
}

export interface GenerateRepoReadinessAuditResult {
  root: string;
  stateDb: string;
  files: string[];
  structuredFiles: string[];
  evidenceId: string;
  blockers: string[];
  warnings: string[];
}

export interface GenerateSecurityBaselineOptions {
  cwd?: string;
  now?: Date;
}

export interface GenerateSecurityBaselineResult {
  root: string;
  stateDb: string;
  files: string[];
  structuredFiles: string[];
  evidenceId: string;
  blockers: string[];
  warnings: string[];
  riskScan: LaunchSecurityRiskScan;
}

export interface LaunchSecurityRiskScan {
  secretFindings: string[];
  licenseFindings: string[];
  dependencyFindings: string[];
  backupRestoreFindings: string[];
  authAndPrivacyFindings: string[];
  prodConfigFindings: string[];
  thirdPartyFindings: string[];
}

export interface RecordSupportTriageOptions {
  cwd?: string;
  request: string;
  outcome: string;
  customer?: string;
  severity?: string;
  category?: string;
  sourceRefs?: string[];
  now?: Date;
}

export interface RecordSupportTriageResult {
  root: string;
  stateDb: string;
  files: string[];
  structuredFiles: string[];
  evidenceId: string;
}

export interface GenerateFounderBottleneckMapOptions {
  cwd?: string;
  bottlenecks?: string[];
  owner?: string;
  systemOfRecord?: string;
  handoffDueDate?: string;
  status?: string;
  now?: Date;
}

export interface GenerateFounderBottleneckMapResult {
  root: string;
  stateDb: string;
  files: string[];
  structuredFiles: string[];
  evidenceId: string;
  bottlenecks: string[];
}

export interface GenerateWorkflowRegistryOptions {
  cwd?: string;
  workflows?: string[];
  delegationRules?: string[];
  approvalBoundaries?: string[];
  allowedAgents?: string[];
  constrainedTaskTypes?: string[];
  now?: Date;
}

export interface GenerateWorkflowRegistryResult {
  root: string;
  stateDb: string;
  files: string[];
  structuredFiles: string[];
  evidenceIds: string[];
  workflows: string[];
  delegationRules: string[];
}

export interface CaptureInstitutionalMemoryOptions {
  cwd?: string;
  knowledge?: string[];
  scope?: string;
  sourceRefs?: string[];
  now?: Date;
}

export interface CaptureInstitutionalMemoryResult {
  root: string;
  stateDb: string;
  files: string[];
  structuredFiles: string[];
  evidenceId: string;
  memoryId: string;
  knowledge: string[];
}

export interface RetrieveStartupInstitutionalMemoryOptions {
  cwd?: string;
  scope?: string;
  query?: string;
  limit?: number;
  now?: Date;
}

export interface GenerateIntegrationMapOptions {
  cwd?: string;
  integrations?: string[];
  lockInSignals?: string[];
  automationCoverage?: string[];
  adoptionSignals?: string[];
  workflowSignals?: string[];
  now?: Date;
}

export interface GenerateIntegrationMapResult {
  root: string;
  stateDb: string;
  files: string[];
  structuredFiles: string[];
  evidenceId: string;
  integrations: string[];
}

export interface GenerateScaleOpsReportOptions {
  cwd?: string;
  period?: string;
  now?: Date;
}

export interface GenerateScaleOpsReportResult {
  root: string;
  stateDb: string;
  files: string[];
  structuredFiles: string[];
  evidenceId: string;
  period: string;
}

export interface ScheduleScaleReportOptions {
  cwd?: string;
  cadence?: string;
  owner?: string;
  nextRunAt?: string;
  periodTemplate?: string;
  now?: Date;
}

export interface ScheduleScaleReportResult {
  root: string;
  stateDb: string;
  files: string[];
  structuredFiles: string[];
  evidenceId: string;
  nextCommand: string;
}

export interface GenerateOpsSopsOptions {
  cwd?: string;
  sops?: string[];
  owner?: string;
  workflow?: string;
  now?: Date;
}

export interface GenerateOpsSopsResult {
  root: string;
  stateDb: string;
  files: string[];
  structuredFiles: string[];
  evidenceId: string;
  sops: string[];
}

export interface VerifyGtmArtifactsOptions {
  cwd?: string;
  claims?: string[];
  evidenceRefs?: string[];
  productState?: string;
  now?: Date;
}

export interface VerifyGtmArtifactsResult {
  root: string;
  stateDb: string;
  files: string[];
  structuredFiles: string[];
  evidenceId: string;
  claims: string[];
}

export interface GenerateScaleStarterPackOptions {
  cwd?: string;
  owner?: string;
  now?: Date;
}

export interface GenerateScaleStarterPackResult {
  root: string;
  stateDb: string;
  files: string[];
  structuredFiles: string[];
  evidenceIds: string[];
  scaleReady: false;
  blockers: string[];
  nextCommands: string[];
}
