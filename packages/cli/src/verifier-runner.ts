import { access } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  createRunsteadId,
  type JsonObject,
  type RunsteadEvent,
  type Task
} from "@runstead/core";
import { appendEventAndProject, openRunsteadDatabase } from "@runstead/state-sqlite";
import {
  commandVerifierResultsPassed,
  type CommandVerifierInput,
  type CommandVerifierResult
} from "@runstead/verifiers";

import {
  runGovernedToolAction,
  ToolActionApprovalRequiredError,
  ToolActionDeniedError
} from "./governed-action.js";
import { withRunsteadManagerLock } from "./manager-lock.js";
import { showGoal } from "./goals.js";
import { loadPolicyProfileFromFile } from "./policy-loader.js";
import { type PolicyProfile } from "./policy.js";
import { requireRunsteadStateDbSync } from "./runstead-root.js";
import { finishWorkerRun, startWorkerRun } from "./runtime-audit.js";
import { shellVerifierAction } from "./verifier-runner-action.js";
import {
  configuredVerifierCommandsFromTask,
  loadVerifierTask,
  verifierCommandsFromTask
} from "./verifier-runner-task-input.js";
import {
  storeCommandVerifierEvidence,
  storeCommandVerifierPolicyEvidence,
  type StoreCommandVerifierEvidenceResult
} from "./verifier-evidence.js";

export interface RunTaskVerifiersOptions {
  cwd?: string;
  taskId: string;
  timeoutMs?: number;
  killGraceMs?: number;
  claim?: boolean;
  mode?: "finalize_task" | "evidence_only";
  now?: Date;
}

export type RunTaskVerifierCommandResult = CommandVerifierResult;

export interface RunTaskVerifiersResult {
  task: Task;
  commandResults: RunTaskVerifierCommandResult[];
}

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
        event: taskEvent(
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
          event: taskEvent(
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

          const finalTask = finalizeTask({
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

          const finalTask = finalizeTask({
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
        event: taskEvent(
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

function verifierOutput(
  commandResults: RunTaskVerifierCommandResult[],
  passed: boolean
): JsonObject {
  return {
    summary: passed
      ? "All verifier commands passed"
      : commandResults.length === 0
        ? "No verifier commands configured"
        : "One or more verifier commands failed",
    commands: commandResults
  };
}

function policyCommandResult(
  command: CommandVerifierInput,
  evidenceResult: StoreCommandVerifierEvidenceResult,
  policyDecisionId: string,
  approvalId?: string
): RunTaskVerifierCommandResult {
  return {
    verifier: command.name,
    exitCode: null,
    timedOut: false,
    forceKilled: false,
    evidenceId: evidenceResult.evidence.id,
    policyDecisionId,
    ...(approvalId === undefined ? {} : { approvalId })
  };
}

function finalizeTask(input: {
  runningTask: Task;
  status: Task["status"];
  output: JsonObject;
  updatedAt: string;
  database: ReturnType<typeof openRunsteadDatabase>;
  projectTaskState: boolean;
}): Task {
  const finalTask: Task = {
    ...input.runningTask,
    status: input.status,
    output: input.output,
    updatedAt: input.updatedAt
  };

  if (input.projectTaskState) {
    appendEventAndProject(input.database, {
      event: taskEvent(
        `task.${input.status}`,
        finalTask,
        finalTask.output ?? {},
        input.updatedAt
      ),
      projection: {
        type: "task",
        value: finalTask
      }
    });
  }

  return finalTask;
}

async function loadVerifierPolicy(input: {
  root: string;
  cwd: string;
  task: Task;
}): Promise<PolicyProfile> {
  const goal = showGoal({ cwd: input.cwd, id: input.task.goalId }).goal;

  for (const path of policyCandidatePaths({
    root: input.root,
    domain: goal.domain,
    ...(goal.policyRef === undefined ? {} : { policyRef: goal.policyRef })
  })) {
    if (await exists(path)) {
      return loadPolicyProfileFromFile(path);
    }
  }

  return loadPolicyProfileFromFile(
    join(input.root, "policies", "repo-maintenance.yaml")
  );
}

function policyCandidatePaths(input: {
  root: string;
  domain: string;
  policyRef?: string;
}): string[] {
  const fallback = join(input.root, "policies", "repo-maintenance.yaml");

  if (input.policyRef === undefined) {
    return [fallback];
  }

  return [
    join(input.root, input.policyRef),
    join(input.root, "domains", input.domain, input.policyRef),
    fallback
  ].filter((path, index, paths) => paths.indexOf(path) === index);
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function taskEvent(
  type: string,
  task: Task,
  payload: JsonObject,
  createdAt: string
): RunsteadEvent {
  return {
    eventId: createRunsteadId("evt"),
    type,
    aggregateType: "task",
    aggregateId: task.id,
    payload,
    createdAt
  };
}
