import type { Command } from "commander";

import { requireRbacPermission } from "../cli-rbac.js";
import { parseStartupGateStage } from "../startup-command-parsers.js";

export function registerStartupCiCommand(startup: Command): Command {
  const startupCi = startup
    .command("ci")
    .description("Generate CI, PR, and release-gate artifacts for startup readiness.");

  startupCi
    .command("summary")
    .description("Write GitHub Check Run, PR comment, and release gate artifacts.")
    .option("--cwd <path>", "Workspace directory")
    .option("--stage <stage>", "Stage to check: idea, mvp, launch, or scale", "launch")
    .option("--domain <id>", "Domain id to evaluate", "ai-native-startup")
    .option("--check-name <name>", "GitHub Check Run name")
    .option("--output-dir <path>", "Directory for CI artifacts")
    .option("--actor <id>", "RBAC subject for CI summary generation", "local-admin")
    .action(
      async (options: {
        cwd?: string;
        stage: string;
        domain: string;
        checkName?: string;
        outputDir?: string;
        actor: string;
      }) => {
        await requireRbacPermission({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          actor: options.actor,
          permission: "evidence.read",
          action: "generate startup CI summary"
        });

        const { formatStartupCiSummary, generateStartupCiSummary } =
          await import("../startup-ci-integration.js");
        const result = await generateStartupCiSummary({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          domain: options.domain,
          stage: parseStartupGateStage(options.stage),
          ...(options.checkName === undefined ? {} : { checkName: options.checkName }),
          ...(options.outputDir === undefined ? {} : { outputDir: options.outputDir })
        });

        console.log(formatStartupCiSummary(result));
        if (result.checkRun.conclusion === "failure") {
          process.exitCode = 1;
        }
      }
    );

  return startupCi;
}
