import type { JsonObject } from "@runstead/core";

import type { WorkspaceCheckpoint } from "./checkpoints.js";
import type { GitDiffScopeVerification } from "./diff-scope-verifier.js";
import type {
  CommitGitChangesResult,
  ListGitChangedFilesResult
} from "./git-branch.js";
import type { CreateGitHubPullRequestResult } from "./github-pr.js";

interface PublishCoverageOutput {
  toolCallId: string;
  policyDecisionId: string;
  approvalId?: string;
}

export function coveredByOutput(coverage: PublishCoverageOutput): JsonObject {
  return {
    coveredByToolCallId: coverage.toolCallId,
    coveredByPolicyDecisionId: coverage.policyDecisionId,
    ...(coverage.approvalId === undefined
      ? {}
      : { coveredByApprovalId: coverage.approvalId })
  };
}

export function checkpointOutput(checkpoint: WorkspaceCheckpoint): JsonObject {
  return {
    checkpointId: checkpoint.id,
    head: checkpoint.head ?? "",
    untrackedFiles: checkpoint.untrackedFiles
  };
}

export function gitChangedFilesOutput(
  changedFiles: ListGitChangedFilesResult
): JsonObject {
  return {
    changedFiles: changedFiles.changedFiles,
    trackedFiles: changedFiles.trackedFiles,
    stagedFiles: changedFiles.stagedFiles,
    untrackedFiles: changedFiles.untrackedFiles,
    excludedFiles: changedFiles.excludedFiles
  };
}

export function gitCommitOutput(commit: CommitGitChangesResult): JsonObject {
  return {
    commitSha: commit.commitSha,
    changedFiles: commit.changedFiles,
    committedFiles: commit.committedFiles,
    stdout: commit.stdout
  };
}

export function diffScopeOutput(diffScope: GitDiffScopeVerification): JsonObject {
  return {
    passed: diffScope.passed,
    changedFiles: diffScope.changedFiles,
    violations: diffScope.violations
  };
}

export function pullRequestOutput(
  pullRequest: CreateGitHubPullRequestResult
): JsonObject {
  return {
    title: pullRequest.title,
    base: pullRequest.base,
    head: pullRequest.head,
    stdout: pullRequest.stdout,
    ...(pullRequest.url === undefined ? {} : { url: pullRequest.url })
  };
}
