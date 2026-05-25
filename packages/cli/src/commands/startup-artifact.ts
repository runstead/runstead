import type { Command } from "commander";

import { requireRbacPermission } from "../cli-rbac.js";
import { parsePositiveInteger } from "../startup-command-parsers.js";

export function registerStartupArtifactCommand(startup: Command): Command {
  const startupArtifact = startup
    .command("artifact")
    .description("Query structured startup artifacts.");

  startupArtifact
    .command("list")
    .description("List structured startup artifacts and their evidence references.")
    .option("--cwd <path>", "Workspace directory")
    .option("--actor <id>", "RBAC subject for artifact reads", "local-admin")
    .action(async (options: { cwd?: string; actor: string }) => {
      await requireRbacPermission({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        actor: options.actor,
        permission: "evidence.read",
        action: "list startup artifacts"
      });

      const { listStartupArtifacts, formatStartupArtifactList } =
        await import("../startup-artifacts.js");
      const result = await listStartupArtifacts({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd })
      });

      console.log(formatStartupArtifactList(result));
    });

  startupArtifact
    .command("show")
    .description("Show a structured startup artifact as JSON.")
    .argument("<ref>", "Artifact id, kind, path, or filename")
    .option("--cwd <path>", "Workspace directory")
    .option("--actor <id>", "RBAC subject for artifact reads", "local-admin")
    .action(async (ref: string, options: { cwd?: string; actor: string }) => {
      await requireRbacPermission({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        actor: options.actor,
        permission: "evidence.read",
        action: "show startup artifact"
      });

      const { showStartupArtifact, formatStartupArtifactShow } =
        await import("../startup-artifacts.js");
      const result = await showStartupArtifact({
        ref,
        ...(options.cwd === undefined ? {} : { cwd: options.cwd })
      });

      console.log(formatStartupArtifactShow(result));
    });

  startupArtifact
    .command("hygiene")
    .description(
      "Write a latest-artifacts view and retention report for startup artifacts."
    )
    .option("--cwd <path>", "Workspace directory")
    .option(
      "--retention-days <days>",
      "Age threshold for unreferenced prune candidates",
      "30"
    )
    .option("--prune", "Delete unreferenced artifacts older than the retention window")
    .option("--actor <id>", "RBAC subject for artifact hygiene", "local-admin")
    .action(
      async (options: {
        cwd?: string;
        retentionDays: string;
        prune?: boolean;
        actor: string;
      }) => {
        await requireRbacPermission({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          actor: options.actor,
          permission: options.prune === true ? "evidence.write" : "evidence.read",
          action:
            options.prune === true
              ? "prune startup artifacts"
              : "inspect startup artifact hygiene"
        });

        const { formatStartupArtifactHygiene, manageStartupArtifactHygiene } =
          await import("../startup-artifact-hygiene.js");
        const result = await manageStartupArtifactHygiene({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          retentionDays: parsePositiveInteger(
            options.retentionDays,
            "--retention-days"
          ),
          prune: options.prune === true
        });

        console.log(formatStartupArtifactHygiene(result));
      }
    );

  return startupArtifact;
}
