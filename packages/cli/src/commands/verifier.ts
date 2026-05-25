import type { Command } from "commander";

import { collectValues } from "../cli-parsers.js";
import { requireRbacPermission } from "../cli-rbac.js";

export function registerVerifierCommand(program: Command): Command {
  const verifier = program.command("verifier").description("Run verifiers.");

  verifier
    .command("run")
    .description("Run verifier commands for a task.")
    .argument("<task-id>", "Task id")
    .option("--cwd <path>", "Workspace directory")
    .option("--timeout-ms <ms>", "Per-command timeout in milliseconds")
    .option("--actor <id>", "RBAC subject for verifier execution", "local-admin")
    .action(
      async (
        taskId: string,
        options: { cwd?: string; timeoutMs?: string; actor: string }
      ) => {
        await requireRbacPermission({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          actor: options.actor,
          permission: "task.run",
          action: "run verifiers"
        });

        const { runTaskVerifiers } = await import("../verifier-runner.js");
        const timeoutMs =
          options.timeoutMs === undefined
            ? undefined
            : Number.parseInt(options.timeoutMs, 10);

        if (
          timeoutMs !== undefined &&
          (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
        ) {
          throw new Error("--timeout-ms must be a positive integer");
        }

        const result = await runTaskVerifiers({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          taskId,
          ...(timeoutMs === undefined ? {} : { timeoutMs })
        });

        console.log(`Task: ${result.task.id}`);
        console.log(`Status: ${result.task.status}`);
        for (const command of result.commandResults) {
          console.log(
            `${command.verifier}: exit=${command.exitCode ?? "unknown"} evidence=${command.evidenceId}`
          );
        }
      }
    );

  verifier
    .command("diff-scope")
    .description(
      "Verify changed files stay within the configured diff scope. Unmanaged helper; governed checks run through CI repair."
    )
    .option("--cwd <path>", "Workspace directory")
    .option("--base <ref>", "Base ref")
    .option("--head <ref>", "Head ref", "HEAD")
    .option("--allowed <pattern>", "Allowed path pattern", collectValues, [])
    .option("--denied <pattern>", "Denied path pattern", collectValues, [])
    .option("--actor <id>", "RBAC subject for verifier execution", "local-admin")
    .action(
      async (options: {
        cwd?: string;
        base?: string;
        head?: string;
        allowed: string[];
        denied: string[];
        actor: string;
      }) => {
        await requireRbacPermission({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          actor: options.actor,
          permission: "task.run",
          action: "run verifiers"
        });

        const { formatGitDiffScopeReport, verifyGitDiffScope } =
          await import("../diff-scope-verifier.js");
        const result = await verifyGitDiffScope({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          ...(options.base === undefined ? {} : { baseRef: options.base }),
          ...(options.head === undefined ? {} : { headRef: options.head }),
          allowedPaths: options.allowed,
          deniedPaths: options.denied
        });

        console.log(formatGitDiffScopeReport(result));
        if (!result.passed) {
          process.exitCode = 1;
        }
      }
    );

  return verifier;
}
