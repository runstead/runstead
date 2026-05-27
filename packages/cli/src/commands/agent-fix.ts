import type { Command } from "commander";

import { collectValues } from "../cli-parsers.js";
import { runAgentFixLikeCommand, type AgentFixCliOptions } from "./agent-fix-runner.js";

export function registerAgentFixCommands(command: Command): void {
  command
    .command("fix")
    .description("Run a checkpointed small-fix agent task with required verifiers.")
    .argument("<prompt...>", "Fix prompt for the local agent")
    .option("--cwd <path>", "Workspace directory")
    .option("--worker <worker>", "Worker to run: codex_direct", "codex_direct")
    .option("--provider <provider>", "Model provider to use with codex_direct")
    .option("--model <model>", "Model to use with codex_direct")
    .option("--base-url <url>", "Model provider base URL")
    .option("--allowed <pattern>", "Allowed workspace path pattern", collectValues, [])
    .option("--denied <pattern>", "Denied workspace path pattern", collectValues, [])
    .option(
      "--verifier <name=command>",
      "Verifier command to run after the fix, or auto to discover common scripts",
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
    .action(async (promptParts: string[], options: AgentFixCliOptions) => {
      await runAgentFixLikeCommand({
        prompt: promptParts.join(" ").trim(),
        presetId: "fix:small",
        title: "Local agent small fix",
        action: "run local agent fix",
        verifierFirst: false,
        options
      });
    });

  command
    .command("repair-test")
    .description("Run verifier-first checkpointed repair for a failing local test.")
    .argument("[focus...]", "Optional repair focus")
    .option("--cwd <path>", "Workspace directory")
    .option("--worker <worker>", "Worker to run: codex_direct", "codex_direct")
    .option("--provider <provider>", "Model provider to use with codex_direct")
    .option("--model <model>", "Model to use with codex_direct")
    .option("--base-url <url>", "Model provider base URL")
    .option("--allowed <pattern>", "Allowed workspace path pattern", collectValues, [])
    .option("--denied <pattern>", "Denied workspace path pattern", collectValues, [])
    .option(
      "--verifier <name=command>",
      "Verifier command to run before and after repair, or auto to discover common scripts",
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
    .action(async (focusParts: string[], options: AgentFixCliOptions) => {
      await runAgentFixLikeCommand({
        prompt: focusParts.join(" ").trim(),
        presetId: "repair:test",
        title: "Local agent test repair",
        action: "run local agent test repair",
        verifierFirst: true,
        options
      });
    });
}
