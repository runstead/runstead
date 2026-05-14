import { createHash } from "node:crypto";
import { join, resolve } from "node:path";

import {
  createRunsteadId,
  type JsonObject,
  type RunsteadEvent,
  type Task
} from "@runstead/core";
import { appendEventAndProject, openRunsteadDatabase } from "@runstead/state-sqlite";

import {
  expireApprovalGrant,
  findApprovedApprovalForAction,
  requestApproval
} from "./approvals.js";
import { loadPolicyProfileFromFile } from "./policy-loader.js";
import type { ActionEnvelope, PolicyProfile } from "./policy.js";
import { recordPolicyDecision } from "./policy-log.js";
import { requireRunsteadStateDbSync } from "./runstead-root.js";
import {
  finishToolCall,
  finishWorkerRun,
  startToolCall,
  startWorkerRun
} from "./runtime-audit.js";
import { claimTask } from "./tasks.js";
import { preflightToolAction } from "./tool-proxy.js";
import {
  storeCommandVerifierEvidence,
  storeCommandVerifierPolicyEvidence,
  type CommandVerifierInput,
  type StoreCommandVerifierEvidenceResult
} from "./verifier-evidence.js";

export interface RunTaskVerifiersOptions {
  cwd?: string;
  taskId: string;
  timeoutMs?: number;
  now?: Date;
}

export interface RunTaskVerifierCommandResult {
  verifier: string;
  exitCode: number | null;
  timedOut: boolean;
  evidenceId: string;
  policyDecisionId?: string;
  approvalId?: string;
}

export interface RunTaskVerifiersResult {
  task: Task;
  commandResults: RunTaskVerifierCommandResult[];
}

export async function runTaskVerifiers(
  options: RunTaskVerifiersOptions
): Promise<RunTaskVerifiersResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const resolvedState = requireRunsteadStateDbSync(cwd);
  const root = resolvedState.root;
  const stateDb = resolvedState.stateDb;
  const createdAt = (options.now ?? new Date()).toISOString();
  const policy = await loadVerifierPolicy(root);
  const task = claimTask({
    cwd,
    id: options.taskId,
    ...(options.now === undefined ? {} : { now: options.now })
  }).task;
  const runningTask: Task = {
    ...task,
    status: "running",
    updatedAt: createdAt
  };
  const commands = verifierCommandsFromTask(task);
  const database = openRunsteadDatabase(stateDb);

  try {
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
      const toolCall = startToolCall({
        database,
        workerRun,
        task: runningTask,
        action,
        ...(options.now === undefined ? {} : { now: options.now })
      });
      const preflight = preflightToolAction({ policy, action });
      const recordedPolicy = recordPolicyDecision({
        cwd,
        stateDb,
        policyId: policy.id,
        action: preflight.action,
        result: preflight.policyResult,
        ...(options.now === undefined ? {} : { now: options.now })
      });
      const approvedGrant =
        preflight.status === "approval_required"
          ? findApprovedApprovalForAction({
              database,
              actionId: preflight.action.actionId,
              ...(options.now === undefined ? {} : { now: options.now })
            })
          : undefined;

      if (preflight.status === "denied") {
        const evidenceResult = await storeCommandVerifierPolicyEvidence({
          cwd,
          runsteadRoot: root,
          database,
          task: runningTask,
          command,
          policyDecisionId: recordedPolicy.decision.id,
          decision: "deny",
          reason: preflight.policyResult.reason,
          ...(options.now === undefined ? {} : { now: options.now })
        });

        commandResults.push(
          policyCommandResult(command, evidenceResult, recordedPolicy.decision.id)
        );
        finishToolCall({
          database,
          toolCall,
          status: "denied",
          policyDecisionId: recordedPolicy.decision.id,
          output: {
            decision: preflight.policyResult.decision,
            reason: preflight.policyResult.reason,
            evidenceId: evidenceResult.evidence.id
          },
          ...(options.now === undefined ? {} : { now: options.now })
        });
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
          database
        });

        return {
          task: finalTask,
          commandResults
        };
      }

      if (preflight.status === "approval_required" && approvedGrant === undefined) {
        const approval = requestApproval({
          database,
          policyDecision: recordedPolicy.decision,
          requestedBy: "runstead:verifier",
          ...(options.now === undefined ? {} : { now: options.now })
        });
        const evidenceResult = await storeCommandVerifierPolicyEvidence({
          cwd,
          runsteadRoot: root,
          database,
          task: runningTask,
          command,
          policyDecisionId: recordedPolicy.decision.id,
          decision: "require_approval",
          reason: preflight.policyResult.reason,
          approvalId: approval.id,
          ...(options.now === undefined ? {} : { now: options.now })
        });

        commandResults.push(
          policyCommandResult(
            command,
            evidenceResult,
            recordedPolicy.decision.id,
            approval.id
          )
        );
        finishToolCall({
          database,
          toolCall,
          status: "approval_required",
          policyDecisionId: recordedPolicy.decision.id,
          output: {
            approvalId: approval.id,
            decision: preflight.policyResult.decision,
            reason: preflight.policyResult.reason,
            evidenceId: evidenceResult.evidence.id
          },
          ...(options.now === undefined ? {} : { now: options.now })
        });
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
          database
        });

        return {
          task: finalTask,
          commandResults
        };
      }

      currentTask = startExecutionAttempt();
      const approvalGrantOutput =
        approvedGrant === undefined
          ? {}
          : {
              approvalId: approvedGrant.id,
              approvalGrant: "used"
            };

      if (approvedGrant !== undefined) {
        expireApprovalGrant({
          database,
          approval: approvedGrant,
          ...(options.now === undefined ? {} : { now: options.now })
        });
      }

      const evidenceResult = await storeCommandVerifierEvidence({
        cwd,
        runsteadRoot: root,
        database,
        task: currentTask,
        command,
        ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
        ...(options.now === undefined ? {} : { now: options.now })
      });

      commandResults.push({
        verifier: evidenceResult.artifact.verifier,
        exitCode: evidenceResult.artifact.result.exitCode,
        timedOut: evidenceResult.artifact.result.timedOut,
        evidenceId: evidenceResult.evidence.id,
        policyDecisionId: recordedPolicy.decision.id,
        ...(approvedGrant === undefined ? {} : { approvalId: approvedGrant.id })
      });
      finishToolCall({
        database,
        toolCall,
        status: "completed",
        policyDecisionId: recordedPolicy.decision.id,
        output: {
          evidenceId: evidenceResult.evidence.id,
          exitCode: evidenceResult.artifact.result.exitCode,
          timedOut: evidenceResult.artifact.result.timedOut,
          ...approvalGrantOutput
        },
        ...(options.now === undefined ? {} : { now: options.now })
      });
    }

    const passed =
      commandResults.length > 0 &&
      commandResults.every(
        (result) => result.exitCode === 0 && result.timedOut === false
      );
    const output = verifierOutput(commandResults, passed);
    const finalTask: Task = {
      ...currentTask,
      status: passed ? "completed" : "failed",
      output,
      updatedAt: createdAt
    };

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

function verifierCommandsFromTask(task: Task): CommandVerifierInput[] {
  const commands = task.input.commands;

  if (!Array.isArray(commands)) {
    return [];
  }

  return (commands as unknown[]).flatMap((command) => {
    if (isRecord(command)) {
      const name = command.name;
      const commandText = command.command;

      if (typeof name !== "string" || typeof commandText !== "string") {
        return [];
      }

      return [
        {
          name,
          command: commandText
        }
      ];
    }

    return [];
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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
}): Task {
  const finalTask: Task = {
    ...input.runningTask,
    status: input.status,
    output: input.output,
    updatedAt: input.updatedAt
  };

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

  return finalTask;
}

function shellVerifierAction(input: {
  task: Task;
  command: CommandVerifierInput;
  index: number;
  cwd: string;
}): ActionEnvelope {
  return {
    actionId: verifierActionId(input),
    actionType: "shell.exec",
    resource: {
      type: "repository",
      path: input.cwd
    },
    context: {
      cwd: input.cwd,
      command: input.command.command
    }
  };
}

function verifierActionId(input: {
  task: Task;
  command: CommandVerifierInput;
  index: number;
}): string {
  const hash = createHash("sha256").update(input.command.command).digest("hex");
  const verifier = input.command.name.replace(/[^a-zA-Z0-9_]+/g, "_");

  return `act_${input.task.id}_${input.index}_${verifier}_${hash.slice(0, 12)}`;
}

async function loadVerifierPolicy(root: string): Promise<PolicyProfile> {
  return loadPolicyProfileFromFile(join(root, "policies", "repo-maintenance.yaml"));
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
