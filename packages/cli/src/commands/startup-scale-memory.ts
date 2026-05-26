import type { Command } from "commander";

import { requireRbacPermission } from "../cli-rbac.js";
import { collectValues, parsePositiveInteger } from "../startup-command-parsers.js";
import { logStructuredFiles } from "./startup-scale-output.js";

export function registerStartupScaleMemoryCommands(startupScale: Command): void {
  startupScale
    .command("memory-capture")
    .description("Capture founder-only knowledge as memory and evidence.")
    .option("--cwd <path>", "Workspace directory")
    .option(
      "--knowledge <text>",
      "Founder-only knowledge to capture",
      collectValues,
      []
    )
    .option("--scope <scope>", "Memory scope", "startup/institutional-memory")
    .option("--source <ref>", "Source reference", collectValues, [])
    .option("--actor <id>", "RBAC subject for memory capture", "local-admin")
    .action(
      async (options: {
        cwd?: string;
        knowledge: string[];
        scope: string;
        source: string[];
        actor: string;
      }) => {
        await requireRbacPermission({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          actor: options.actor,
          permission: "memory.write",
          action: "capture startup institutional memory"
        });
        await requireRbacPermission({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          actor: options.actor,
          permission: "evidence.write",
          action: "record startup institutional memory evidence"
        });

        const { captureInstitutionalMemory } = await import("../startup-automation.js");
        const result = await captureInstitutionalMemory({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          knowledge: options.knowledge,
          scope: options.scope,
          sourceRefs: options.source
        });

        console.log(`Captured institutional memory: ${result.memoryId}`);
        console.log(`Recorded memory evidence: ${result.evidenceId}`);
        for (const file of result.files) {
          console.log(`Wrote memory artifact: ${file}`);
        }
        logStructuredFiles(result.structuredFiles);
      }
    );

  startupScale
    .command("memory-retrieve")
    .description("Retrieve institutional memory for worker context and audit access.")
    .option("--cwd <path>", "Workspace directory")
    .option("--scope <scope>", "Memory scope", "startup/institutional-memory")
    .option("--query <text>", "Search text")
    .option("--limit <number>", "Maximum facts to return", "10")
    .option("--actor <id>", "RBAC subject for memory retrieval", "local-admin")
    .action(
      async (options: {
        cwd?: string;
        scope: string;
        query?: string;
        limit: string;
        actor: string;
      }) => {
        await requireRbacPermission({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          actor: options.actor,
          permission: "memory.read",
          action: "retrieve startup institutional memory"
        });

        const { retrieveStartupInstitutionalMemory } =
          await import("../startup-automation.js");
        const result = retrieveStartupInstitutionalMemory({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          scope: options.scope,
          ...(options.query === undefined ? {} : { query: options.query }),
          limit: parsePositiveInteger(options.limit, "--limit")
        });

        console.log(`Retrieval audit: ${result.retrievalId}`);
        for (const fact of result.facts) {
          console.log(`${fact.id} ${fact.scope}: ${fact.content}`);
        }
      }
    );
}
