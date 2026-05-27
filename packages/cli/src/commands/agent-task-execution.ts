export interface AgentRunReportOptions {
  cwd?: string;
  taskId: string;
}

export interface RunCreatedLocalAgentTaskOptions extends AgentRunReportOptions {
  verifierFirst?: boolean;
}

export async function runCreatedLocalAgentTask(
  options: RunCreatedLocalAgentTaskOptions
): Promise<void> {
  if (options.verifierFirst === true) {
    const { attachLocalAgentVerifierEvidence } = await import("../local-agent.js");

    await attachLocalAgentVerifierEvidence({
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      taskId: options.taskId
    });
  }

  await runAndReportLocalAgentTask(options);
}

export async function runAndReportLocalAgentTask(
  options: AgentRunReportOptions
): Promise<void> {
  const { formatLocalAgentRunReport, localAgentRunExitCode, runLocalAgentTask } =
    await import("../local-agent.js");
  const result = await runLocalAgentTask({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    taskId: options.taskId
  });
  const exitCode = localAgentRunExitCode(result);

  console.log(formatLocalAgentRunReport(result));
  if (exitCode !== 0) {
    process.exitCode = exitCode;
  }
}
