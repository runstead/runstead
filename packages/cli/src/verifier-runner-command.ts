import type { Task, WorkerRun } from "@runstead/core";
import type { RunsteadDatabase } from "@runstead/state-sqlite";

import {
  runGovernedToolAction,
  ToolActionApprovalRequiredError,
  ToolActionDeniedError
} from "./governed-action.js";
import type { PolicyProfile } from "./policy.js";
import {
  storeCommandVerifierEvidence,
  storeCommandVerifierPolicyEvidence
} from "./verifier-evidence.js";
import { shellVerifierAction } from "./verifier-runner-action.js";
import { policyCommandResult } from "./verifier-runner-output.js";
import type {
  RunTaskVerifierCommandResult,
  RunTaskVerifiersOptions
} from "./verifier-runner-types.js";

export interface RunVerifierCommandInput {
  cwd: string;
  root: string;
  stateDb: string;
  database: RunsteadDatabase;
  policy: PolicyProfile;
  runningTask: Task;
  currentTask: Task;
  workerRun: WorkerRun;
  command: Parameters<typeof shellVerifierAction>[0]["command"];
  index: number;
  timeoutMs?: RunTaskVerifiersOptions["timeoutMs"];
  killGraceMs?: RunTaskVerifiersOptions["killGraceMs"];
  now?: Date;
  startExecutionAttempt: () => Task;
}

export type RunVerifierCommandResult =
  | {
      status: "completed";
      currentTask: Task;
      commandResult: RunTaskVerifierCommandResult;
    }
  | {
      status: "blocked" | "waiting_approval";
      currentTask: Task;
      commandResult: RunTaskVerifierCommandResult;
    };

export async function runVerifierCommand(
  input: RunVerifierCommandInput
): Promise<RunVerifierCommandResult> {
  const action = shellVerifierAction({
    task: input.runningTask,
    command: input.command,
    index: input.index,
    cwd: input.cwd
  });
  let currentTask = input.currentTask;

  try {
    const governed = await runGovernedToolAction({
      cwd: input.cwd,
      stateDb: input.stateDb,
      database: input.database,
      policy: input.policy,
      task: input.runningTask,
      workerRun: input.workerRun,
      action,
      requestedBy: "runstead:verifier",
      ...(input.now === undefined ? {} : { now: input.now }),
      run: async () => {
        currentTask = input.startExecutionAttempt();
        const value = await storeCommandVerifierEvidence({
          cwd: input.cwd,
          runsteadRoot: input.root,
          database: input.database,
          task: currentTask,
          command: input.command,
          ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
          ...(input.killGraceMs === undefined
            ? {}
            : { killGraceMs: input.killGraceMs }),
          ...(input.now === undefined ? {} : { now: input.now })
        });

        return {
          value,
          output: {
            evidenceId: value.evidence.id,
            exitCode: value.artifact.result.exitCode,
            timedOut: value.artifact.result.timedOut,
            forceKilled: value.artifact.result.forceKilled
          }
        };
      }
    });
    const evidenceResult = governed.value;

    return {
      status: "completed",
      currentTask,
      commandResult: {
        verifier: evidenceResult.artifact.verifier,
        exitCode: evidenceResult.artifact.result.exitCode,
        timedOut: evidenceResult.artifact.result.timedOut,
        forceKilled: evidenceResult.artifact.result.forceKilled,
        evidenceId: evidenceResult.evidence.id,
        policyDecisionId: governed.policyDecision.id,
        ...(governed.approval === undefined ? {} : { approvalId: governed.approval.id })
      }
    };
  } catch (error) {
    if (error instanceof ToolActionDeniedError) {
      const evidenceResult = await storeCommandVerifierPolicyEvidence({
        cwd: input.cwd,
        runsteadRoot: input.root,
        database: input.database,
        task: input.runningTask,
        command: input.command,
        policyDecisionId: error.policyDecision.id,
        decision: "deny",
        reason: error.policyDecision.reason,
        ...(input.now === undefined ? {} : { now: input.now })
      });

      return {
        status: "blocked",
        currentTask,
        commandResult: policyCommandResult(
          input.command,
          evidenceResult,
          error.policyDecision.id
        )
      };
    }

    if (error instanceof ToolActionApprovalRequiredError) {
      const evidenceResult = await storeCommandVerifierPolicyEvidence({
        cwd: input.cwd,
        runsteadRoot: input.root,
        database: input.database,
        task: input.runningTask,
        command: input.command,
        policyDecisionId: error.policyDecision.id,
        decision: "require_approval",
        reason: error.policyDecision.reason,
        approvalId: error.approval.id,
        ...(input.now === undefined ? {} : { now: input.now })
      });

      return {
        status: "waiting_approval",
        currentTask,
        commandResult: policyCommandResult(
          input.command,
          evidenceResult,
          error.policyDecision.id,
          error.approval.id
        )
      };
    }

    throw error;
  }
}
