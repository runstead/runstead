import type { Command } from "commander";

import {
  collectValues,
  parseCiRepairWorkerKind,
  parseRequiredPositiveInteger
} from "../cli-parsers.js";
import { requireRbacPermission } from "../cli-rbac.js";
import { resolveVerifierCommandOptions } from "../local-agent-verifier-options.js";

interface AgentTestCliOptions {
  cwd?: string;
  worker: string;
  provider?: string;
  model?: string;
  baseUrl?: string;
  verifier: string[];
  maxTurns?: string;
  maxToolCalls?: string;
  maxFailedToolCalls?: string;
  actor: string;
}

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
    .action(async (focusParts: string[], options: AgentTestCliOptions) => {
      let verifierCommands = await resolveVerifierCommandOptions(
        options.verifier,
        "agent test",
        {
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          required: false
        }
      );

      await requireRbacPermission({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        actor: options.actor,
        permission: "task.run",
        action: "run local agent test triage"
      });

      const worker = parseCiRepairWorkerKind(options.worker);

      if (worker !== "codex_direct") {
        throw new Error("agent test currently supports --worker codex_direct only");
      }

      const {
        attachLocalAgentVerifierEvidence,
        createLocalAgentTask,
        formatLocalAgentRunReport,
        localAgentRunExitCode,
        runLocalAgentTask
      } = await import("../local-agent.js");
      const { resolveConfiguredLocalAgentPreset } =
        await import("../local-agent-presets.js");
      const focus = focusParts.join(" ").trim();
      let resolvedPreset = await resolveConfiguredLocalAgentPreset(
        "test:triage",
        {
          ...(focus.length === 0 ? {} : { prompt: focus }),
          verifierNames: verifierCommands.map((command) => command.name)
        },
        {
          ...(options.cwd === undefined ? {} : { cwd: options.cwd })
        }
      );

      if (
        verifierCommands.length === 0 &&
        resolvedPreset.verifierCommands !== undefined
      ) {
        verifierCommands = resolvedPreset.verifierCommands;
        resolvedPreset = await resolveConfiguredLocalAgentPreset(
          "test:triage",
          {
            ...(focus.length === 0 ? {} : { prompt: focus }),
            verifierNames: verifierCommands.map((command) => command.name)
          },
          {
            ...(options.cwd === undefined ? {} : { cwd: options.cwd })
          }
        );
      }

      if (verifierCommands.length === 0) {
        throw new Error(
          "agent test requires at least one --verifier name=command, --verifier auto, or preset verifier"
        );
      }
      const model = options.model ?? resolvedPreset.model;
      const created = await createLocalAgentTask({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        prompt: resolvedPreset.prompt,
        preset: resolvedPreset.preset.id,
        title: "Local agent test triage",
        worker,
        ...(options.provider === undefined ? {} : { provider: options.provider }),
        ...(model === undefined ? {} : { model }),
        ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
        mode: resolvedPreset.preset.mode,
        checkpoint: resolvedPreset.preset.checkpoint,
        verifierCommands,
        ...(options.maxTurns === undefined
          ? { maxTurns: resolvedPreset.preset.maxTurns }
          : {
              maxTurns: parseRequiredPositiveInteger(options.maxTurns, "--max-turns")
            }),
        ...(options.maxToolCalls === undefined
          ? { maxToolCalls: resolvedPreset.preset.maxToolCalls }
          : {
              maxToolCalls: parseRequiredPositiveInteger(
                options.maxToolCalls,
                "--max-tool-calls"
              )
            }),
        ...(options.maxFailedToolCalls === undefined
          ? { maxFailedToolCalls: resolvedPreset.preset.maxFailedToolCalls }
          : {
              maxFailedToolCalls: parseRequiredPositiveInteger(
                options.maxFailedToolCalls,
                "--max-failed-tool-calls"
              )
            })
      });

      await attachLocalAgentVerifierEvidence({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        taskId: created.task.id
      });

      const result = await runLocalAgentTask({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        taskId: created.task.id
      });
      const exitCode = localAgentRunExitCode(result);

      console.log(formatLocalAgentRunReport(result));
      if (exitCode !== 0) {
        process.exitCode = exitCode;
      }
    });
}
