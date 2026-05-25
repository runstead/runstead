import type { RunsteadEvent } from "@runstead/core";

import type {
  LaunchReadinessStatus,
  LaunchReadinessTrustSummary
} from "./launch-readiness-trust.js";

export interface GenerateLaunchReadinessReportOptions {
  cwd?: string;
  domain?: string;
  target?: LaunchReadinessTarget;
  now?: Date;
}

export interface LaunchReadinessReportResult {
  root: string;
  stateDb: string;
  domain: string;
  reportPath: string;
  jsonPath: string;
  markdown: string;
  event: RunsteadEvent;
  status: LaunchReadinessStatus;
  targetStatus: LaunchReadinessTargetStatus;
  blockers: string[];
  trustSummary: LaunchReadinessTrustSummary;
}

export type LaunchReadinessTarget = "local" | "staging" | "production";

export type LaunchReadinessTargetStatus =
  | "local_launch_ready"
  | "local_launch_blocked"
  | "staging_launch_ready"
  | "staging_launch_blocked"
  | "public_launch_ready"
  | "public_launch_blocked";
