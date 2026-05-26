import { resolve } from "node:path";

import type { Task } from "@runstead/core";
import { appendEventAndProject, openRunsteadDatabase } from "@runstead/state-sqlite";

import { localAgentEvent } from "./local-agent-actions.js";
import {
  formatVerifierEvidencePrompt,
  requiredTaskString,
  verifierEvidenceInput
} from "./local-agent-prompt.js";
import {
  localAgentTaskMode,
  verifierCommandsFromLocalAgentTask
} from "./local-agent-task-input.js";
import { LOCAL_AGENT_TASK_TYPE } from "./local-agent-types.js";
import { requireRunsteadStateDb } from "./runstead-root.js";
import { showTask } from "./tasks.js";
import {
  runTaskVerifiersUnlocked,
  type RunTaskVerifiersResult
} from "./verifier-runner.js";

export async function attachLocalAgentVerifierEvidence(options: {
  cwd?: string;
  taskId: string;
  now?: Date;
}): Promise<RunTaskVerifiersResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const state = await requireRunsteadStateDb(cwd);
  const verifierResult = await runTaskVerifiersUnlocked({
    cwd,
    taskId: options.taskId,
    claim: true,
    mode: "evidence_only",
    ...(options.now === undefined ? {} : { now: options.now })
  });
  const currentTask = showTask({ cwd, id: options.taskId }).task;

  if (!isLocalAgentTaskForVerifierRun(currentTask)) {
    throw new Error(`Task ${options.taskId} is not a local agent task`);
  }

  const prompt = requiredTaskString(currentTask, "prompt");
  const updatedAt = (options.now ?? new Date()).toISOString();
  const task: Task = {
    ...currentTask,
    status: "queued",
    input: {
      ...currentTask.input,
      prompt: `${prompt}\n\n${formatVerifierEvidencePrompt(verifierResult.commandResults)}`,
      verifierEvidence: verifierResult.commandResults.map(verifierEvidenceInput)
    },
    updatedAt
  };
  const database = openRunsteadDatabase(state.stateDb);

  try {
    appendEventAndProject(database, {
      event: localAgentEvent(
        "task.verifier_evidence_attached",
        "task",
        task.id,
        updatedAt,
        {
          previousStatus: currentTask.status,
          verifierEvidence: task.input.verifierEvidence
        }
      ),
      projection: {
        type: "task",
        value: task
      }
    });
  } finally {
    database.close();
  }

  return verifierResult;
}

export async function runLocalAgentVerifiersIfNeeded(options: {
  cwd: string;
  task: Task;
  now?: Date;
}): Promise<RunTaskVerifiersResult | undefined> {
  if (
    localAgentTaskMode(options.task) === "read-only" ||
    verifierCommandsFromLocalAgentTask(options.task).length === 0
  ) {
    return undefined;
  }

  return runTaskVerifiersUnlocked({
    cwd: options.cwd,
    taskId: options.task.id,
    claim: false,
    mode: "evidence_only",
    ...(options.now === undefined ? {} : { now: options.now })
  });
}

function isLocalAgentTaskForVerifierRun(task: Task): boolean {
  return task.domain === "repo-maintenance" && task.type === LOCAL_AGENT_TASK_TYPE;
}
