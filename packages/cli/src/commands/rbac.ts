import type { Command } from "commander";

export function registerRbacCommand(program: Command): Command {
  const rbac = program.command("rbac").description("Manage local RBAC. Experimental.");

  rbac
    .command("init")
    .description("Initialize the local RBAC policy.")
    .option("--cwd <path>", "Workspace directory")
    .option("--subject <id>", "Initial subject id", "local-admin")
    .option("--role <role>", "Initial role", "admin")
    .option("--force", "Overwrite an existing RBAC policy")
    .action(
      async (options: {
        cwd?: string;
        subject: string;
        role: string;
        force?: boolean;
      }) => {
        const { initRbac } = await import("../rbac.js");
        const result = await initRbac({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          subject: options.subject,
          role: options.role,
          ...(options.force === undefined ? {} : { force: options.force })
        });

        console.log(
          `${result.overwritten ? "Overwrote" : "Initialized"} RBAC policy: ${result.path}`
        );
      }
    );

  rbac
    .command("grant")
    .description("Grant a role to a subject.")
    .argument("<subject>", "Subject id")
    .argument("<role>", "Role name")
    .option("--cwd <path>", "Workspace directory")
    .option("--actor <id>", "RBAC subject for RBAC management", "local-admin")
    .action(
      async (
        subject: string,
        role: string,
        options: { cwd?: string; actor: string }
      ) => {
        const { grantRole } = await import("../rbac.js");
        const result = await grantRole({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          actor: options.actor,
          subject,
          role
        });

        console.log(`Granted ${role} to ${subject}`);
        console.log(`RBAC policy: ${result.path}`);
      }
    );

  rbac
    .command("check")
    .description("Check whether a subject has a permission.")
    .argument("<subject>", "Subject id")
    .argument("<permission>", "Permission name")
    .option("--cwd <path>", "Workspace directory")
    .action(async (subject: string, permission: string, options: { cwd?: string }) => {
      const { checkPermission, formatRbacCheckResult } = await import("../rbac.js");
      const result = await checkPermission({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        subject,
        permission
      });

      console.log(formatRbacCheckResult(result));
      if (result.decision === "deny") {
        process.exitCode = 1;
      }
    });

  return rbac;
}
