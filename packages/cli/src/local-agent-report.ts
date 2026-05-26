import { resolve } from "node:path";

import type { Goal, Task } from "@runstead/core";
import { openRunsteadDatabase } from "@runstead/state-sqlite";

import { showGoal } from "./goals.js";
import {
  readLocalAgentReportToolCalls,
  summarizeLocalAgentAudit,
  type LocalAgentAuditSummary,
  type LocalAgentReportToolCall
} from "./local-agent-report-store.js";
import { requireRunsteadStateDb } from "./runstead-root.js";
import { showTask } from "./tasks.js";

export {
  formatLocalAgentAuditSummary,
  formatLocalAgentTaskReport,
  formatLocalAgentTaskReportJson,
  formatLocalAgentTaskReportMarkdown,
  formatLocalAgentWarnings
} from "./local-agent-report-format.js";
export {
  readLocalAgentReportToolCalls,
  summarizeLocalAgentAudit
} from "./local-agent-report-store.js";
export type { LocalAgentToolFailureKind } from "./local-agent-report-tool-call.js";
export type {
  LocalAgentAuditCount,
  LocalAgentAuditSummary,
  LocalAgentPolicyDecisionCount,
  LocalAgentReportToolCall
} from "./local-agent-report-store.js";

const LOCAL_AGENT_TASK_TYPE = "local_agent_task";

export interface LocalAgentTaskReport {
  cwd: string;
  task: Task;
  goal: Goal;
  audit: LocalAgentAuditSummary;
  toolCalls: LocalAgentReportToolCall[];
}

export async function loadLocalAgentTaskReport(options: {
  cwd?: string;
  taskId: string;
}): Promise<LocalAgentTaskReport> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const state = await requireRunsteadStateDb(cwd);
  const task = showTask({ cwd, id: options.taskId }).task;

  if (!isLocalAgentTask(task)) {
    throw new Error(`Task ${options.taskId} is not a local agent task`);
  }

  const goal = showGoal({ cwd, id: task.goalId }).goal;
  const database = openRunsteadDatabase(state.stateDb);

  try {
    return {
      cwd,
      task,
      goal,
      audit: summarizeLocalAgentAudit(database, task.id),
      toolCalls: readLocalAgentReportToolCalls(database, task.id)
    };
  } finally {
    database.close();
  }
}

function isLocalAgentTask(task: Task): boolean {
  return task.type === LOCAL_AGENT_TASK_TYPE;
}
