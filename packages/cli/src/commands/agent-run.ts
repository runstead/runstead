import type { Command } from "commander";

import { collectValues } from "../cli-parsers.js";
import { runAgentRunCommand, type AgentRunCliOptions } from "./agent-run-runner.js";

export function registerAgentRunCommand(command: Command): void {
  command
    .command("run")
    .description("Run a governed local agent task against the current workspace.")
    .argument("[prompt...]", "Task prompt for the local agent")
    .option("--cwd <path>", "Workspace directory")
    .option(
      "--worker <worker>",
      "Worker to run: codex_direct, codex_cli, or claude_code",
      "codex_direct"
    )
    .option("--provider <provider>", "Model provider to use with codex_direct")
    .option(
      "--model <model>",
      "Model to use with codex_direct, codex_cli, or claude_code"
    )
    .option("--base-url <url>", "Model provider base URL")
    .option("--mode <mode>", "Agent mode: read-only, edit, or repair", "read-only")
    .option("--preset <id>", "Local agent preset id")
    .option("--allowed <pattern>", "Allowed workspace path pattern", collectValues, [])
    .option("--denied <pattern>", "Denied workspace path pattern", collectValues, [])
    .option(
      "--verifier <name=command>",
      "Verifier command for edit/repair tasks, or auto to discover common scripts",
      collectValues,
      []
    )
    .option("--max-turns <number>", "Maximum Codex Direct tool turns")
    .option("--max-tool-calls <number>", "Maximum Codex Direct tool calls")
    .option(
      "--max-failed-tool-calls <number>",
      "Maximum recoverable Codex Direct tool failures"
    )
    .option("--actor <id>", "RBAC subject for local agent execution", "local-admin")
    .action(async (promptParts: string[], options: AgentRunCliOptions) =>
      runAgentRunCommand(promptParts, options)
    );
}
