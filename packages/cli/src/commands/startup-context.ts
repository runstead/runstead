import type { Command } from "commander";

import { requireRbacPermission } from "../cli-rbac.js";
import { collectValues, emptyAsUndefined } from "../startup-command-parsers.js";

export function registerStartupContextCommand(startup: Command): Command {
  const startupContext = startup
    .command("context")
    .description("Generate startup agent context artifacts.");

  startupContext
    .command("generate")
    .description("Generate AGENTS.md, CLAUDE.md, CODEX.md, and evidence.")
    .option("--cwd <path>", "Workspace directory")
    .option("--force", "Overwrite existing context files")
    .option(
      "--architecture <text>",
      "Architecture principle to include",
      collectValues,
      []
    )
    .option("--constraint <text>", "Technical constraint to include", collectValues, [])
    .option("--accepted-debt <text>", "Accepted technical debt", collectValues, [])
    .option("--actor <id>", "RBAC subject for context generation", "local-admin")
    .action(
      async (options: {
        cwd?: string;
        force?: boolean;
        architecture: string[];
        constraint: string[];
        acceptedDebt: string[];
        actor: string;
      }) => {
        await requireRbacPermission({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          actor: options.actor,
          permission: "evidence.write",
          action: "generate startup context"
        });

        const { generateStartupContext } = await import("../startup-automation.js");
        const architecturePrinciples = emptyAsUndefined(options.architecture);
        const technicalConstraints = emptyAsUndefined(options.constraint);
        const acceptedDebt = emptyAsUndefined(options.acceptedDebt);
        const result = await generateStartupContext({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          force: options.force === true,
          ...(architecturePrinciples === undefined ? {} : { architecturePrinciples }),
          ...(technicalConstraints === undefined ? {} : { technicalConstraints }),
          ...(acceptedDebt === undefined ? {} : { acceptedDebt })
        });

        console.log(`Generated startup context evidence: ${result.evidenceId}`);
        for (const file of result.files) {
          console.log(`Wrote context file: ${file}`);
        }
        logStructuredFiles(result.structuredFiles);
      }
    );

  return startupContext;
}

function logStructuredFiles(files: string[]): void {
  for (const file of files) {
    console.log(`Wrote structured artifact: ${file}`);
  }
}
