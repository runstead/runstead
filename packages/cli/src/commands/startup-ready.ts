import type { Command } from "commander";

import {
  parseLocalAgentWorker,
  parsePositiveInteger
} from "../startup-command-parsers.js";
import type { StartupReadyProgressEvent } from "../startup-ready.js";

export function registerStartupReadyCommand(startup: Command): Command {
  return startup
    .command("ready")
    .description("Run or plan the end-to-end startup readiness orchestrator.")
    .option("--cwd <path>", "Workspace directory")
    .option(
      "--stage <stage>",
      "Stage to assess: mvp, launch, scale, or complete",
      "launch"
    )
    .option(
      "--target <target>",
      "Readiness target: local, staging, or production",
      "local"
    )
    .option(
      "--worker <worker>",
      "Worker: codex_direct, codex_cli, or claude_code. Defaults from --governance."
    )
    .option(
      "--governance <profile>",
      "Governance profile: auto, readiness, or governed",
      "auto"
    )
    .option("--plan", "Only print the readiness run plan")
    .option("--resume <run-id>", "Resume an existing startup readiness run")
    .option("--write-ci", "Generate or update the target repo readiness workflow")
    .option("--ci", "Write CI summary artifacts for this readiness run")
    .option(
      "--refresh-context",
      "Regenerate startup context and measurement docs instead of ingesting existing files"
    )
    .option(
      "--write-tracked-context",
      "Write root structured context JSON artifacts when refreshing context"
    )
    .option(
      "--interactive",
      "Prompt for founder context and measurement details before generating evidence"
    )
    .option(
      "--guided",
      "Print and persist guided next steps for missing evidence and launch blockers"
    )
    .option(
      "--force-build",
      "Call the MVP build worker even when existing app verifiers are already runnable"
    )
    .option("--repair", "Alias for --force-build")
    .option(
      "--live-runtime-backend",
      "Connect to the configured Postgres backend before executing readiness"
    )
    .option(
      "--migrate-runtime-backend",
      "Apply Postgres runtime backend migrations before a live backend check"
    )
    .option(
      "--runtime-backend-schema <name>",
      "Postgres schema name for live runtime backend checks",
      "runstead"
    )
    .option(
      "--app-template <template>",
      "Built-in scaffold template for empty repos, currently static-todo"
    )
    .option("--app-type <type>", "Built-in app profile, currently local-first-web")
    .option("--max-attempts <count>", "Maximum bounded MVP repair attempts", "2")
    .action(
      async (options: {
        cwd?: string;
        stage: string;
        target: string;
        worker?: string;
        governance: string;
        plan?: boolean;
        resume?: string;
        writeCi?: boolean;
        ci?: boolean;
        refreshContext?: boolean;
        writeTrackedContext?: boolean;
        interactive?: boolean;
        guided?: boolean;
        forceBuild?: boolean;
        repair?: boolean;
        liveRuntimeBackend?: boolean;
        migrateRuntimeBackend?: boolean;
        runtimeBackendSchema: string;
        appTemplate?: string;
        appType?: string;
        maxAttempts: string;
      }) => {
        const {
          formatStartupReadyProgress,
          formatStartupReadyPlan,
          formatStartupReadinessRun,
          parseStartupReadyStage,
          parseStartupReadyGovernanceProfile,
          parseStartupReadyTarget,
          planStartupReady,
          runStartupReady
        } = await import("../startup-ready.js");
        const { parseStartupAppType, parseStartupScaffoldTemplate } =
          await import("../startup-scaffold-profile.js");
        const target = parseStartupReadyTarget(options.target);
        const common = {
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          stage: parseStartupReadyStage(options.stage),
          target,
          ...(options.worker === undefined
            ? {}
            : { worker: parseLocalAgentWorker(options.worker) }),
          governanceProfile: parseStartupReadyGovernanceProfile(options.governance),
          ...(options.resume === undefined ? {} : { resumeRunId: options.resume }),
          writeCi: options.writeCi === true,
          ci: options.ci === true,
          refreshContext: options.refreshContext === true,
          writeTrackedContext: options.writeTrackedContext === true,
          interactive: options.interactive === true,
          guided: options.guided === true,
          forceBuild: options.forceBuild === true || options.repair === true,
          runtimeBackendLive:
            options.liveRuntimeBackend === true ||
            options.migrateRuntimeBackend === true,
          runtimeBackendMigrate: options.migrateRuntimeBackend === true,
          runtimeBackendSchema: options.runtimeBackendSchema,
          ...(options.appTemplate === undefined
            ? {}
            : { appTemplate: parseStartupScaffoldTemplate(options.appTemplate) }),
          ...(options.appType === undefined
            ? {}
            : { appType: parseStartupAppType(options.appType) }),
          maxAttempts: parsePositiveInteger(options.maxAttempts, "--max-attempts"),
          onProgress: (event: StartupReadyProgressEvent) => {
            console.error(formatStartupReadyProgress(event));
          }
        };

        if (options.plan === true) {
          console.log(formatStartupReadyPlan(await planStartupReady(common)));
          return;
        }

        const result = await runStartupReady(common);

        console.log(formatStartupReadinessRun(result.run));
      }
    );
}
