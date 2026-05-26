import type {
  ReadinessExternalCheck,
  ReadinessReleaseDecision,
  ReadinessTarget
} from "@runstead/runtime";

import type { StartupGitHubActionsRemoteStatus } from "./startup-ci-github-actions.js";
import type { StartupGateCheckResult } from "./startup-evidence.js";

export function remoteActionsReadinessCheck(
  remoteActions: StartupGitHubActionsRemoteStatus,
  target: ReadinessTarget
): ReadinessExternalCheck {
  if (remoteActions.status === "failed") {
    return {
      id: "github_actions",
      status: "failed",
      blocker: `remote GitHub Actions failed for HEAD${remoteActions.workflowName === undefined ? "" : ` (${remoteActions.workflowName})`}`
    };
  }

  if (remoteActions.status === "pending") {
    return {
      id: "github_actions",
      status: "pending",
      blocker: `remote GitHub Actions are still pending for HEAD${remoteActions.workflowName === undefined ? "" : ` (${remoteActions.workflowName})`}`
    };
  }

  if (remoteActions.status === "not_configured") {
    return unresolvedRemoteActionsReadinessCheck(remoteActions, target);
  }

  if (remoteActions.status === "unknown") {
    return unresolvedRemoteActionsReadinessCheck(remoteActions, target);
  }

  return {
    id: "github_actions",
    status: "passed"
  };
}

export function readinessTargetForRemoteCi(
  readiness:
    | {
        target?: string;
        verdict: string;
      }
    | undefined
): ReadinessTarget {
  if (
    readiness?.target === "local" ||
    readiness?.target === "staging" ||
    readiness?.target === "production"
  ) {
    return readiness.target;
  }

  if (readiness?.verdict.startsWith("local_")) {
    return "local";
  }

  if (readiness?.verdict.startsWith("staging_")) {
    return "staging";
  }

  if (readiness?.verdict.startsWith("public_")) {
    return "production";
  }

  return "production";
}

export function startupGateFromReleaseDecision(
  gate: StartupGateCheckResult,
  decision: ReadinessReleaseDecision
): StartupGateCheckResult {
  return {
    ...gate,
    passed: decision.passed,
    blockers: decision.blockers,
    warnings: decision.warnings
  };
}

function unresolvedRemoteActionsReadinessCheck(
  remoteActions: StartupGitHubActionsRemoteStatus,
  target: ReadinessTarget
): ReadinessExternalCheck {
  const message = remoteActionsDiagnosticMessage(remoteActions);

  if (target !== "local") {
    return {
      id: "github_actions",
      status: "failed",
      blocker: `${message}; ${target} target requires confirmed remote GitHub Actions.`
    };
  }

  return {
    id: "github_actions",
    status: remoteActions.status,
    warning: `${message}; local target treats remote GitHub Actions as advisory.`
  };
}

function remoteActionsDiagnosticMessage(
  remoteActions: StartupGitHubActionsRemoteStatus
): string {
  const availability =
    remoteActions.status === "not_configured" ? "not configured" : "unknown";
  const details = [
    `remote GitHub Actions status is ${availability}`,
    remoteActions.reason === undefined ? undefined : `reason: ${remoteActions.reason}`,
    remoteActions.diagnosis === undefined
      ? undefined
      : `likely cause: ${remoteActions.diagnosis}`,
    remoteActions.setupAction === undefined
      ? undefined
      : `setup action: ${remoteActions.setupAction}`
  ].filter((part): part is string => part !== undefined);

  return details.join("; ");
}
