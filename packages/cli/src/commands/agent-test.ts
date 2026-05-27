import type { Command } from "commander";

import { collectValues } from "../cli-parsers.js";
import { runAgentTestCommand, type AgentTestCliOptions } from "./agent-test-runner.js";

export function registerAgentTestCommand(command: Command): void {
  command
    .command("test")
    .description("Run verifiers first, then triage the evidence with Codex Direct.")
    .argument("[focus...]", "Optional test triage focus")
    .option("--cwd <path>", "Workspace directory")
    .option("--worker <worker>", "Worker to run: codex_direct", "codex_direct")
    .option("--provider <provider>", "Model provider to use with codex_direct")
    .option("--model <model>", "Model to use with codex_direct")
    .option("--base-url <url>", "Model provider base URL")
    .option(
      "--verifier <name=command>",
      "Verifier command to run before triage, or auto to discover common scripts",
      collectValues,
      []
    )
    .option("--max-turns <number>", "Override preset Codex Direct tool turns")
    .option("--max-tool-calls <number>", "Override preset Codex Direct tool calls")
    .option(
      "--max-failed-tool-calls <number>",
      "Override preset recoverable Codex Direct tool failures"
    )
    .option("--actor <id>", "RBAC subject for local agent execution", "local-admin")
    .action(async (focusParts: string[], options: AgentTestCliOptions) =>
      runAgentTestCommand(focusParts, options)
    );
}
