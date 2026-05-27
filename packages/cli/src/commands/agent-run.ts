import type { Command } from "commander";

import {
  collectValues,
  parseCiRepairWorkerKind,
  parseRequiredPositiveInteger
} from "../cli-parsers.js";
import { requireRbacPermission } from "../cli-rbac.js";
import {
  localAgentPresetRunsVerifiersFirst,
  resolvePresetVerifierCommandOptions
} from "../local-agent-verifier-options.js";

interface AgentRunCliOptions {
  cwd?: string;
  worker: string;
  provider?: string;
  model?: string;
  baseUrl?: string;
  mode: string;
  preset?: string;
  allowed: string[];
  denied: string[];
  verifier: string[];
  maxTurns?: string;
  maxToolCalls?: string;
  maxFailedToolCalls?: string;
  actor: string;
}

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
    .action(async (promptParts: string[], options: AgentRunCliOptions) => {
      await requireRbacPermission({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        actor: options.actor,
        permission: "task.run",
        action: "run local agent tasks"
      });

      const worker = parseCiRepairWorkerKind(options.worker);

      if (
        worker !== "codex_direct" &&
        worker !== "codex_cli" &&
        worker !== "claude_code"
      ) {
        throw new Error(
          "agent run currently supports --worker codex_direct, codex_cli, or claude_code"
        );
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
      const prompt = promptParts.join(" ").trim();
      let resolvedPreset =
        options.preset === undefined
          ? undefined
          : await resolveConfiguredLocalAgentPreset(
              options.preset,
              {
                ...(prompt.length === 0 ? {} : { prompt })
              },
              {
                ...(options.cwd === undefined ? {} : { cwd: options.cwd })
              }
            );

      const verifierCommands = await resolvePresetVerifierCommandOptions({
        values: options.verifier,
        commandName: "agent run",
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        ...(resolvedPreset === undefined ? {} : { preset: resolvedPreset })
      });

      if (resolvedPreset !== undefined) {
        resolvedPreset = await resolveConfiguredLocalAgentPreset(
          resolvedPreset.preset.id,
          {
            ...(prompt.length === 0 ? {} : { prompt }),
            verifierNames: verifierCommands.map((item) => item.name)
          },
          {
            ...(options.cwd === undefined ? {} : { cwd: options.cwd })
          }
        );
      }

      if (resolvedPreset === undefined && prompt.length === 0) {
        throw new Error("agent run prompt is required unless --preset is set");
      }

      const model = options.model ?? resolvedPreset?.model;
      const created = await createLocalAgentTask({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        prompt: resolvedPreset?.prompt ?? prompt,
        ...(resolvedPreset === undefined
          ? {}
          : {
              preset: resolvedPreset.preset.id,
              checkpoint: resolvedPreset.preset.checkpoint
            }),
        worker,
        ...(options.provider === undefined ? {} : { provider: options.provider }),
        ...(model === undefined ? {} : { model }),
        ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
        mode:
          resolvedPreset === undefined
            ? parseLocalAgentMode(options.mode)
            : resolvedPreset.preset.mode,
        allowedPaths: options.allowed,
        deniedPaths: options.denied,
        verifierCommands,
        ...(options.maxTurns === undefined
          ? resolvedPreset === undefined
            ? {}
            : { maxTurns: resolvedPreset.preset.maxTurns }
          : {
              maxTurns: parseRequiredPositiveInteger(options.maxTurns, "--max-turns")
            }),
        ...(options.maxToolCalls === undefined
          ? resolvedPreset === undefined
            ? {}
            : { maxToolCalls: resolvedPreset.preset.maxToolCalls }
          : {
              maxToolCalls: parseRequiredPositiveInteger(
                options.maxToolCalls,
                "--max-tool-calls"
              )
            }),
        ...(options.maxFailedToolCalls === undefined
          ? resolvedPreset === undefined
            ? {}
            : { maxFailedToolCalls: resolvedPreset.preset.maxFailedToolCalls }
          : {
              maxFailedToolCalls: parseRequiredPositiveInteger(
                options.maxFailedToolCalls,
                "--max-failed-tool-calls"
              )
            })
      });

      if (
        resolvedPreset !== undefined &&
        localAgentPresetRunsVerifiersFirst(resolvedPreset.preset.verifierPolicy)
      ) {
        await attachLocalAgentVerifierEvidence({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          taskId: created.task.id
        });
      }

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

function parseLocalAgentMode(value: string): "read-only" | "edit" | "repair" {
  if (value === "read-only" || value === "edit" || value === "repair") {
    return value;
  }

  throw new Error("--mode must be read-only, edit, or repair");
}
