import { requireRbacPermission } from "../cli-rbac.js";

export interface AgentUndoCliOptions {
  cwd?: string;
  actor: string;
  allowHeadMismatch?: boolean;
}

export async function runAgentUndoCommand(
  taskId: string,
  options: AgentUndoCliOptions
): Promise<void> {
  await requireRbacPermission({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    actor: options.actor,
    permission: "repo.manage",
    action: "undo local agent tasks"
  });

  const { formatLocalAgentUndoReport, undoLocalAgentTask } =
    await import("../local-agent.js");
  const result = await undoLocalAgentTask({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    taskId,
    actor: options.actor,
    allowHeadMismatch: options.allowHeadMismatch === true
  });

  console.log(formatLocalAgentUndoReport(result));
}
