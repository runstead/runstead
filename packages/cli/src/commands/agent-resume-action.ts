import { requireRbacPermission } from "../cli-rbac.js";

export interface AgentResumeCliOptions {
  cwd?: string;
  actor: string;
}

export async function runAgentResumeCommand(
  targetId: string,
  options: AgentResumeCliOptions
): Promise<void> {
  await requireRbacPermission({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    actor: options.actor,
    permission: "task.run",
    action: "resume local agent tasks"
  });

  const {
    formatLocalAgentRunReport,
    localAgentRunExitCode,
    resolveLocalAgentResumeTarget,
    runLocalAgentTask
  } = await import("../local-agent.js");
  const resumeTarget = resolveLocalAgentResumeTarget({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    targetId
  });
  const result = await runLocalAgentTask({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    taskId: resumeTarget.taskId
  });
  const exitCode = localAgentRunExitCode(result);

  if (resumeTarget.note !== undefined) {
    console.log(resumeTarget.note);
  }
  console.log(formatLocalAgentRunReport(result));
  if (exitCode !== 0) {
    process.exitCode = exitCode;
  }
}
