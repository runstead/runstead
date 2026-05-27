import type { Command } from "commander";

import {
  runAgentReviewCommand,
  type AgentReviewCliOptions
} from "./agent-review-runner.js";

export function registerAgentReviewCommand(command: Command): void {
  command
    .command("review")
    .description("Run a preset read-only review of the current git diff.")
    .argument("[focus...]", "Optional review focus")
    .option("--cwd <path>", "Workspace directory")
    .option("--worker <worker>", "Worker to run: codex_direct", "codex_direct")
    .option("--provider <provider>", "Model provider to use with codex_direct")
    .option("--model <model>", "Model to use with codex_direct")
    .option("--base-url <url>", "Model provider base URL")
    .option("--staged", "Review the staged diff instead of the unstaged diff")
    .option("--base <ref>", "Review HEAD against a base ref")
    .option("--unpushed", "Review commits ahead of the upstream branch")
    .option("--max-turns <number>", "Override preset Codex Direct tool turns")
    .option("--max-tool-calls <number>", "Override preset Codex Direct tool calls")
    .option(
      "--max-failed-tool-calls <number>",
      "Override preset recoverable Codex Direct tool failures"
    )
    .option("--actor <id>", "RBAC subject for local agent execution", "local-admin")
    .action(async (focusParts: string[], options: AgentReviewCliOptions) =>
      runAgentReviewCommand(focusParts, options)
    );
}
