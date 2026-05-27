import type { Command } from "commander";

import { runAgentInspectCommand } from "./agent-inspect-action.js";

export function registerAgentInspectCommand(command: Command): void {
  command
    .command("inspect")
    .description("Run a preset read-only repository inspection.")
    .argument("[focus...]", "Optional inspection focus")
    .option("--cwd <path>", "Workspace directory")
    .option("--worker <worker>", "Worker to run: codex_direct", "codex_direct")
    .option("--provider <provider>", "Model provider to use with codex_direct")
    .option("--model <model>", "Model to use with codex_direct")
    .option("--base-url <url>", "Model provider base URL")
    .option("--depth <depth>", "Inspection depth: smoke or standard", "smoke")
    .option("--max-turns <number>", "Override preset Codex Direct tool turns")
    .option("--max-tool-calls <number>", "Override preset Codex Direct tool calls")
    .option(
      "--max-failed-tool-calls <number>",
      "Override preset recoverable Codex Direct tool failures"
    )
    .option("--actor <id>", "RBAC subject for local agent execution", "local-admin")
    .action(runAgentInspectCommand);
}
