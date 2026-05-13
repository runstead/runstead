import { join, resolve } from "node:path";

import type { Task } from "@runstead/core";

import {
  createCiRepairTaskFromWorkflowRun,
  type CreateCiRepairTaskResult
} from "./ci-repair.js";
import {
  restoreWorkspaceCheckpoint,
  type RestoreWorkspaceCheckpointResult
} from "./checkpoints.js";
import {
  buildRunsteadBranchName,
  createGitBranch,
  type GitRunner
} from "./git-branch.js";
import type { GitHubCliRunner } from "./github-actions.js";
import {
  createGitHubPullRequest,
  type CreateGitHubPullRequestResult
} from "./github-pr.js";
import { showGoal } from "./goals.js";
import { requireRunsteadRootSync } from "./runstead-root.js";
import {
  runTaskVerifiers,
  type RunTaskVerifiersOptions,
  type RunTaskVerifiersResult
} from "./verifier-runner.js";
import type { CommandVerifierInput } from "./verifier-evidence.js";
import {
  verifyGitDiffScope,
  type GitDiffRunner,
  type GitDiffScopeVerification
} from "./diff-scope-verifier.js";
import {
  startWrappedWorker,
  type WorkerProcessRunner,
  type WrappedWorkerKind,
  type WrappedWorkerRunResult
} from "./wrapped-worker.js";

export type CiRepairGitRunner = GitRunner & GitDiffRunner;

export interface RunCiRepairOrchestratorOptions {
  cwd?: string;
  runId: string;
  worker: WrappedWorkerKind;
  base?: string;
  draft?: boolean;
  allowedPaths?: string[];
  deniedPaths?: string[];
  verifierCommands: CommandVerifierInput[];
  githubRunner?: GitHubCliRunner;
  gitRunner?: CiRepairGitRunner;
  workerRunner?: WorkerProcessRunner;
  verifierRunner?: (
    options: RunTaskVerifiersOptions
  ) => Promise<RunTaskVerifiersResult>;
  now?: Date;
}

export interface RunCiRepairOrchestratorResult {
  ciRepair: CreateCiRepairTaskResult;
  branchName: string;
  workerResult: WrappedWorkerRunResult;
  diffScope: GitDiffScopeVerification;
  verifierResult: RunTaskVerifiersResult;
  pullRequest: CreateGitHubPullRequestResult;
}

export async function runCiRepairOrchestrator(
  options: RunCiRepairOrchestratorOptions
): Promise<RunCiRepairOrchestratorResult> {
  if (options.verifierCommands.length === 0) {
    throw new Error("At least one verifier command is required for CI repair");
  }

  const cwd = resolve(options.cwd ?? process.cwd());
  const root = requireRunsteadRootSync(cwd).root;
  const ciRepair = await createCiRepairTaskFromWorkflowRun({
    cwd,
    runId: options.runId,
    verifierCommands: options.verifierCommands,
    ...(options.githubRunner === undefined ? {} : { runner: options.githubRunner }),
    ...(options.now === undefined ? {} : { now: options.now })
  });
  const goal = showGoal({ cwd, id: ciRepair.task.goalId }).goal;
  const base = options.base ?? ciRepair.workflowRun.headBranch ?? "main";
  const branchName = buildRunsteadBranchName({
    taskId: ciRepair.task.id,
    slug: `ci-${ciRepair.workflowRun.runId}`
  });

  await createGitBranch({
    cwd,
    branchName,
    baseRef: base,
    ...(options.gitRunner === undefined ? {} : { runner: options.gitRunner })
  });

  const workerResult = await startWrappedWorker({
    worker: options.worker,
    goal,
    task: ciRepair.task,
    workspace: cwd,
    evidenceDir: join(root, "evidence"),
    checkpointDir: join(root, "checkpoints"),
    policySummary: "repo-maintenance policy enforced by Runstead",
    ...(options.allowedPaths === undefined ? {} : { allowedScope: options.allowedPaths }),
    ...(options.deniedPaths === undefined ? {} : { deniedActions: options.deniedPaths }),
    verifierContract: options.verifierCommands.map(
      (command) => `${command.name}: ${command.command}`
    ),
    instructions: [
      `Repair GitHub Actions run ${ciRepair.workflowRun.runId}.`,
      `Use CI evidence ${ciRepair.evidence.id} before changing code.`,
      "Keep the diff small and leave final verification to Runstead."
    ],
    ...(options.gitRunner === undefined ? {} : { checkpointRunner: options.gitRunner }),
    ...(options.workerRunner === undefined ? {} : { runner: options.workerRunner })
  });

  if (workerResult.exitCode !== 0) {
    await rollbackWorkerChanges({
      cwd,
      root,
      workerResult,
      ...(options.gitRunner === undefined ? {} : { gitRunner: options.gitRunner })
    });
    throw new Error(
      `CI repair worker exited ${workerResult.exitCode}: ${workerResult.stderr}`
    );
  }

  const diffScope = await verifyGitDiffScope({
    cwd,
    baseRef: base,
    headRef: "HEAD",
    allowedPaths: options.allowedPaths ?? [],
    deniedPaths: options.deniedPaths ?? [],
    ...(options.gitRunner === undefined ? {} : { runner: options.gitRunner })
  });

  if (!diffScope.passed) {
    await rollbackWorkerChanges({
      cwd,
      root,
      workerResult,
      ...(options.gitRunner === undefined ? {} : { gitRunner: options.gitRunner })
    });
    throw new Error(`CI repair diff scope failed with ${diffScope.violations.length} violation(s)`);
  }

  const verifierResult = await (options.verifierRunner ?? runTaskVerifiers)({
    cwd,
    taskId: ciRepair.task.id,
    ...(options.now === undefined ? {} : { now: options.now })
  });

  if (verifierResult.task.status !== "completed") {
    await rollbackWorkerChanges({
      cwd,
      root,
      workerResult,
      ...(options.gitRunner === undefined ? {} : { gitRunner: options.gitRunner })
    });
    throw new Error(`CI repair verifier ended with task status ${verifierResult.task.status}`);
  }

  const pullRequest = await createGitHubPullRequest({
    cwd,
    title: `Repair CI run ${ciRepair.workflowRun.runId}`,
    body: buildCiRepairPullRequestBody(ciRepair, verifierResult.task),
    base,
    head: branchName,
    draft: options.draft === true,
    taskId: ciRepair.task.id,
    goalId: ciRepair.task.goalId,
    evidence: [
      {
        id: ciRepair.evidence.id,
        type: ciRepair.evidence.type,
        summary: ciRepair.evidence.summary ?? "GitHub workflow run evidence",
        uri: ciRepair.evidence.uri
      }
    ],
    ...(options.githubRunner === undefined ? {} : { runner: options.githubRunner })
  });

  return {
    ciRepair,
    branchName,
    workerResult,
    diffScope,
    verifierResult,
    pullRequest
  };
}

export function formatCiRepairOrchestratorReport(
  result: RunCiRepairOrchestratorResult
): string {
  return [
    "Runstead CI repair orchestrator",
    `Task: ${result.ciRepair.task.id}`,
    `Branch: ${result.branchName}`,
    `Worker: ${result.workerResult.worker} exit=${result.workerResult.exitCode}`,
    `Diff scope: ${result.diffScope.passed ? "passed" : "failed"}`,
    `Verifier task: ${result.verifierResult.task.status}`,
    `Pull request: ${result.pullRequest.url ?? result.pullRequest.head}`
  ].join("\n");
}

function buildCiRepairPullRequestBody(
  ciRepair: CreateCiRepairTaskResult,
  verifierTask: Task
): string {
  return [
    `Runstead repaired GitHub Actions run ${ciRepair.workflowRun.runId}.`,
    "",
    `Workflow: ${ciRepair.workflowRun.workflowName ?? "unknown"}`,
    `Conclusion: ${ciRepair.workflowRun.conclusion ?? "unknown"}`,
    `Verifier status: ${verifierTask.status}`
  ].join("\n");
}

async function rollbackWorkerChanges(options: {
  cwd: string;
  root: string;
  workerResult: WrappedWorkerRunResult;
  gitRunner?: CiRepairGitRunner;
}): Promise<RestoreWorkspaceCheckpointResult | undefined> {
  const checkpoint = options.workerResult.checkpointBefore;

  if (checkpoint === undefined) {
    return undefined;
  }

  return restoreWorkspaceCheckpoint({
    workspace: options.cwd,
    checkpointDir: join(options.root, "checkpoints"),
    checkpointId: checkpoint.id,
    allowHeadMismatch: true,
    ...(options.gitRunner === undefined ? {} : { runner: options.gitRunner })
  });
}
