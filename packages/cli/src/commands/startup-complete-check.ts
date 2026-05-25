import type { Command } from "commander";

import { requireRbacPermission } from "../cli-rbac.js";

export function registerStartupCompleteCheckCommand(startup: Command): Command {
  startup
    .command("complete-check")
    .description(
      "Run the minimal complete product audit across launch report, CI gate, dashboard, diagnostics, remediation, evidence, and events."
    )
    .option("--cwd <path>", "Workspace directory")
    .option("--domain <id>", "Domain id to evaluate", "ai-native-startup")
    .option(
      "--target <target>",
      "Launch target: local, staging, or production",
      "local"
    )
    .option("--print", "Print the generated markdown")
    .option("--actor <id>", "RBAC subject for complete product audit", "local-admin")
    .action(
      async (options: {
        cwd?: string;
        domain: string;
        target: string;
        print?: boolean;
        actor: string;
      }) => {
        const common = {
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          actor: options.actor
        };

        await requireRbacPermission({
          ...common,
          permission: "evidence.write",
          action: "write startup complete product audit evidence"
        });
        await requireRbacPermission({
          ...common,
          permission: "audit.read",
          action: "read startup complete product audit inputs"
        });
        await requireRbacPermission({
          ...common,
          permission: "dashboard.manage",
          action: "build startup complete product dashboard surface"
        });
        await requireRbacPermission({
          ...common,
          permission: "task.run",
          action: "plan startup complete product remediation"
        });

        const {
          formatStartupCompleteProductCheck,
          generateStartupCompleteProductCheck
        } = await import("../startup-complete-check.js");
        const { parseStartupReadyTarget } = await import("../startup-ready.js");
        const result = await generateStartupCompleteProductCheck({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          domain: options.domain,
          target: parseStartupReadyTarget(options.target)
        });

        console.log(`Generated startup complete product check: ${result.markdownPath}`);
        console.log(`JSON: ${result.jsonPath}`);
        console.log(`Status: ${result.status}`);
        console.log(`Score: ${Math.round(result.score * 100)}%`);
        console.log(`Evidence: ${result.evidenceId}`);
        console.log(`Event: ${result.event.eventId}`);

        if (options.print === true) {
          console.log("");
          console.log(formatStartupCompleteProductCheck(result));
        }

        if (result.status !== "complete") {
          process.exitCode = 1;
        }
      }
    );

  return startup;
}
