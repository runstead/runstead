import type { Command } from "commander";

import { requireRbacPermission } from "../cli-rbac.js";
import { parseStartupAssessStages } from "../startup-command-parsers.js";

export function registerStartupAssessCommand(startup: Command): Command {
  return startup
    .command("assess")
    .description("Assess startup gates across MVP, launch, and scale.")
    .option("--cwd <path>", "Workspace directory")
    .option("--stage <stage>", "Stage to assess: all, mvp, launch, or scale", "all")
    .option("--domain <id>", "Domain id to evaluate", "ai-native-startup")
    .option("--actor <id>", "RBAC subject for assessment", "local-admin")
    .action(
      async (options: {
        cwd?: string;
        stage: string;
        domain: string;
        actor: string;
      }) => {
        await requireRbacPermission({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          actor: options.actor,
          permission: "evidence.read",
          action: "assess startup gates"
        });

        const { checkStartupGate } = await import("../startup-evidence.js");
        const stages = parseStartupAssessStages(options.stage);
        const results = [];

        for (const stage of stages) {
          results.push(
            await checkStartupGate({
              ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
              domain: options.domain,
              stage
            })
          );
        }

        console.log("Startup assessment:");
        for (const result of results) {
          console.log(
            `- ${result.stage}: ${result.passed ? "passed" : "blocked"} (${result.blockers.length} blocker${result.blockers.length === 1 ? "" : "s"})`
          );
        }
      }
    );
}
