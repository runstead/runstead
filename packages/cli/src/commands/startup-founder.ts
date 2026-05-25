import type { Command } from "commander";

import {
  collectValues,
  parseLocalAgentWorker,
  parsePositiveInteger
} from "../startup-command-parsers.js";
import {
  formatWorkerProcessProgress,
  type WorkerProcessProgress
} from "../wrapped-worker.js";

export function registerStartupFounderCommands(startup: Command): void {
  registerOnboardCommand(startup);
  registerBuildMvpCommand(startup);
  registerLaunchCheckCommand(startup);
  registerScaleCheckCommand(startup);
}

function registerOnboardCommand(startup: Command): void {
  startup
    .command("onboard")
    .description("Run the short founder onboarding path for an AI-coded MVP repo.")
    .option("--cwd <path>", "Workspace directory")
    .option(
      "--profile <profile>",
      "Policy profile to generate when Runstead is not initialized: default or trusted-local",
      "trusted-local"
    )
    .option("--force", "Overwrite generated context and measurement artifacts")
    .option("--write-ci", "Generate a GitHub Actions verifier workflow")
    .action(
      async (options: {
        cwd?: string;
        profile: "default" | "trusted-local";
        force?: boolean;
        writeCi?: boolean;
      }) => {
        const { formatStartupOnboard, startupOnboard } =
          await import("../startup-founder-flow.js");
        const result = await startupOnboard({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          profile: options.profile,
          force: options.force === true,
          writeCi: options.writeCi === true
        });

        console.log(formatStartupOnboard(result));
      }
    );
}

function registerBuildMvpCommand(startup: Command): void {
  startup
    .command("build-mvp")
    .description("Run the short founder MVP build path with a local agent worker.")
    .option("--cwd <path>", "Workspace directory")
    .option(
      "--worker <worker>",
      "Worker: codex_direct, codex_cli, or claude_code",
      "codex_cli"
    )
    .option("--model <model>", "Model override for worker execution")
    .option("--prompt <text>", "Override the default MVP build prompt")
    .option(
      "--dependency-policy <policy>",
      "Dependency policy: approval-required, allow-listed, or deny-new",
      "approval-required"
    )
    .option(
      "--allow-dependency <name>",
      "Allowed dependency package or class when --dependency-policy allow-listed",
      collectValues,
      []
    )
    .option("--max-attempts <count>", "Maximum bounded MVP repair attempts", "2")
    .option("--max-turns <count>", "Maximum codex_direct turns per MVP attempt", "24")
    .action(
      async (options: {
        cwd?: string;
        worker: string;
        model?: string;
        prompt?: string;
        dependencyPolicy: string;
        allowDependency: string[];
        maxAttempts: string;
        maxTurns: string;
      }) => {
        const {
          formatStartupDependencyApprovalBoundary,
          formatStartupBuildMvp,
          formatStartupWorkerGovernanceNotice,
          resolveStartupDependencyApprovalBoundary,
          startupBuildMvp
        } = await import("../startup-founder-flow.js");
        const worker = parseLocalAgentWorker(options.worker);
        const dependencyApproval = resolveStartupDependencyApprovalBoundary({
          policy: options.dependencyPolicy,
          allowedDependencies: options.allowDependency
        });

        console.log(formatStartupWorkerGovernanceNotice(worker));
        console.log(
          `Dependency policy: ${formatStartupDependencyApprovalBoundary(dependencyApproval)}`
        );
        const result = await startupBuildMvp({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          worker,
          ...(options.model === undefined ? {} : { model: options.model }),
          ...(options.prompt === undefined ? {} : { prompt: options.prompt }),
          dependencyPolicy: dependencyApproval.policy,
          allowedDependencies: dependencyApproval.allowedDependencies,
          maxAttempts: parsePositiveInteger(options.maxAttempts, "--max-attempts"),
          maxTurns: parsePositiveInteger(options.maxTurns, "--max-turns"),
          onWorkerProgress: logWrappedWorkerProgress
        });

        console.log(formatStartupBuildMvp(result));
      }
    );
}

function registerLaunchCheckCommand(startup: Command): void {
  startup
    .command("launch-check")
    .description("Run the short founder launch readiness check path.")
    .option("--cwd <path>", "Workspace directory")
    .action(async (options: { cwd?: string }) => {
      const { formatStartupLaunchCheck, startupLaunchCheck } =
        await import("../startup-founder-flow.js");
      const result = await startupLaunchCheck({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd })
      });

      console.log(formatStartupLaunchCheck(result));
    });
}

function registerScaleCheckCommand(startup: Command): void {
  startup
    .command("scale-check")
    .description("Run the short founder scale readiness check path.")
    .option("--cwd <path>", "Workspace directory")
    .action(async (options: { cwd?: string }) => {
      const { formatStartupScaleCheck, startupScaleCheck } =
        await import("../startup-founder-flow.js");
      const result = await startupScaleCheck({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd })
      });

      console.log(formatStartupScaleCheck(result));
    });
}

function logWrappedWorkerProgress(progress: WorkerProcessProgress): void {
  console.error(formatWorkerProcessProgress(progress));
}
