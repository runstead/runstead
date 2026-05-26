import { resolve } from "node:path";

import type { Task } from "@runstead/core";
import { appendEventAndProject, openRunsteadDatabase } from "@runstead/state-sqlite";
import { commandVerifierResultsPassed } from "@runstead/verifiers";

import {
  runGovernedToolAction,
  ToolActionApprovalRequiredError,
  ToolActionDeniedError
} from "./governed-action.js";
import { withRunsteadManagerLock } from "./manager-lock.js";
import { requireRunsteadStateDbSync } from "./runstead-root.js";
import { finishWorkerRun, startWorkerRun } from "./runtime-audit.js";
import { shellVerifierAction } from "./verifier-runner-action.js";
import { loadVerifierPolicy } from "./verifier-runner-policy.js";
import {
  configuredVerifierCommandsFromTask,
  loadVerifierTask,
  verifierCommandsFromTask
} from "./verifier-runner-task-input.js";
import {
  finalizeVerifierTask,
  verifierTaskEvent
} from "./verifier-runner-task-state.js";
import {
  storeCommandVerifierEvidence,
  storeCommandVerifierPolicyEvidence
} from "./verifier-evidence.js";
import { policyCommandResult, verifierOutput } from "./verifier-runner-output.js";
import type {
  RunTaskVerifierCommandResult,
  RunTaskVerifiersOptions,
  RunTaskVerifiersResult
} from "./verifier-runner-types.js";

export type {
  RunTaskVerifierCommandResult,
  RunTaskVerifiersOptions,
  RunTaskVerifiersResult
} from "./verifier-runner-types.js";

export async function runTaskVerifiers(
  options: RunTaskVerifiersOptions
): Promise<RunTaskVerifiersResult> {
  const cwd = resolve(options.cwd ?? process.cwd());

  return withRunsteadManagerLock({ cwd }, () =>
    runTaskVerifiersUnlocked({
      ...options,
      cwd
    })
  );
}

export async function runTaskVerifiersUnlocked(
  options: RunTaskVerifiersOptions
): Promise<RunTaskVerifiersResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const resolvedState = requireRunsteadStateDbSync(cwd);
  const root = resolvedState.root;
  const stateDb = resolvedState.stateDb;
  const createdAt = (options.now ?? new Date()).toISOString();
  const projectTaskState = options.mode !== "evidence_only";
  const task = loadVerifierTask({
    cwd,
    taskId: options.taskId,
    ...(options.claim === undefined ? {} : { claim: options.claim }),
    ...(options.now === undefined ? {} : { now: options.now })
  });
  const commands = await verifierCommandsFromTask({
    cwd,
    task,
    ...(options.now === undefined ? {} : { now: options.now })
  });
  const taskWithCommands =
    commands.length > 0 && configuredVerifierCommandsFromTask(task).length === 0
      ? {
          ...task,
          input: {
            ...task.input,
            commands
          }
        }
      : task;
  const policy = await loadVerifierPolicy({ root, cwd, task: taskWithCommands });
  const runningTask: Task = {
    ...taskWithCommands,
    status: "running",
    updatedAt: createdAt
  };
  const database = openRunsteadDatabase(stateDb);

  try {
    if (projectTaskState) {
      appendEventAndProject(database, {
        event: verifierTaskEvent(
          "task.started",
          runningTask,
          { attempt: runningTask.attempt },
          createdAt
        ),
        projection: {
          type: "task",
          value: runningTask
        }
      });
    }
    let currentTask = runningTask;
    let executionAttemptStarted = false;
    const startExecutionAttempt = (): Task => {
      if (executionAttemptStarted) {
        return currentTask;
      }

      executionAttemptStarted = true;
      currentTask = {
        ...currentTask,
        attempt: currentTask.attempt + 1,
        updatedAt: createdAt
      };
      if (projectTaskState) {
        appendEventAndProject(database, {
          event: verifierTaskEvent(
            "task.execution_started",
            currentTask,
            {
              previousAttempt: task.attempt,
              attempt: currentTask.attempt
            },
            createdAt
          ),
          projection: {
            type: "task",
            value: currentTask
          }
        });
      }

      return currentTask;
    };
    const workerRun = startWorkerRun({
      database,
      task: runningTask,
      workerType: "shell_verifier",
      enforcementLevel: "policy_enforced",
      ...(options.now === undefined ? {} : { now: options.now })
    });

    const commandResults: RunTaskVerifierCommandResult[] = [];

    for (const [index, command] of commands.entries()) {
      const action = shellVerifierAction({
        task: runningTask,
        command,
        index,
        cwd
      });

      try {
        const governed = await runGovernedToolAction({
          cwd,
          stateDb,
          database,
          policy,
          task: runningTask,
          workerRun,
          action,
          requestedBy: "runstead:verifier",
          ...(options.now === undefined ? {} : { now: options.now }),
          run: async () => {
            currentTask = startExecutionAttempt();
            const value = await storeCommandVerifierEvidence({
              cwd,
              runsteadRoot: root,
              database,
              task: currentTask,
              command,
              ...(options.timeoutMs === undefined
                ? {}
                : { timeoutMs: options.timeoutMs }),
              ...(options.killGraceMs === undefined
                ? {}
                : { killGraceMs: options.killGraceMs }),
              ...(options.now === undefined ? {} : { now: options.now })
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

        commandResults.push({
          verifier: evidenceResult.artifact.verifier,
          exitCode: evidenceResult.artifact.result.exitCode,
          timedOut: evidenceResult.artifact.result.timedOut,
          forceKilled: evidenceResult.artifact.result.forceKilled,
          evidenceId: evidenceResult.evidence.id,
          policyDecisionId: governed.policyDecision.id,
          ...(governed.approval === undefined
            ? {}
            : { approvalId: governed.approval.id })
        });
      } catch (error) {
        if (error instanceof ToolActionDeniedError) {
          const evidenceResult = await storeCommandVerifierPolicyEvidence({
            cwd,
            runsteadRoot: root,
            database,
            task: runningTask,
            command,
            policyDecisionId: error.policyDecision.id,
            decision: "deny",
            reason: error.policyDecision.reason,
            ...(options.now === undefined ? {} : { now: options.now })
          });

          commandResults.push(
            policyCommandResult(command, evidenceResult, error.policyDecision.id)
          );
          finishWorkerRun({
            database,
            workerRun,
            status: "blocked",
            output: verifierOutput(commandResults, false),
            ...(options.now === undefined ? {} : { now: options.now })
          });

          const finalTask = finalizeVerifierTask({
            runningTask: currentTask,
            status: "blocked",
            output: verifierOutput(commandResults, false),
            updatedAt: createdAt,
            database,
            projectTaskState
          });

          return {
            task: finalTask,
            commandResults
          };
        }

        if (error instanceof ToolActionApprovalRequiredError) {
          const evidenceResult = await storeCommandVerifierPolicyEvidence({
            cwd,
            runsteadRoot: root,
            database,
            task: runningTask,
            command,
            policyDecisionId: error.policyDecision.id,
            decision: "require_approval",
            reason: error.policyDecision.reason,
            approvalId: error.approval.id,
            ...(options.now === undefined ? {} : { now: options.now })
          });

          commandResults.push(
            policyCommandResult(
              command,
              evidenceResult,
              error.policyDecision.id,
              error.approval.id
            )
          );
          finishWorkerRun({
            database,
            workerRun,
            status: "waiting_approval",
            output: verifierOutput(commandResults, false),
            ...(options.now === undefined ? {} : { now: options.now })
          });

          const finalTask = finalizeVerifierTask({
            runningTask: currentTask,
            status: "waiting_approval",
            output: verifierOutput(commandResults, false),
            updatedAt: createdAt,
            database,
            projectTaskState
          });

          return {
            task: finalTask,
            commandResults
          };
        }

        throw error;
      }
    }

    const passed = commandVerifierResultsPassed(commandResults);
    const output = verifierOutput(commandResults, passed);
    const finalTask: Task = {
      ...currentTask,
      status: passed ? "completed" : "failed",
      output,
      updatedAt: createdAt
    };

    if (projectTaskState) {
      appendEventAndProject(database, {
        event: verifierTaskEvent(
          passed ? "task.completed" : "task.failed",
          finalTask,
          finalTask.output ?? {},
          createdAt
        ),
        projection: {
          type: "task",
          value: finalTask
        }
      });
    }
    finishWorkerRun({
      database,
      workerRun,
      status: passed ? "completed" : "failed",
      output,
      ...(options.now === undefined ? {} : { now: options.now })
    });

    return {
      task: finalTask,
      commandResults
    };
  } finally {
    database.close();
  }
}
