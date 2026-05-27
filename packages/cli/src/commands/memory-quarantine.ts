import type { Command } from "commander";

import { collectValues, parseDateOption, parseOptionalFloat } from "../cli-parsers.js";
import { requireRbacPermission } from "../cli-rbac.js";

export function registerMemoryQuarantineCommand(memory: Command): void {
  memory
    .command("quarantine")
    .description("Record a memory candidate in quarantine.")
    .requiredOption("--scope <scope>", "Memory scope, for example repo:acme/app")
    .requiredOption("--type <type>", "Memory type")
    .requiredOption("--content <text>", "Memory candidate content")
    .option("--cwd <path>", "Workspace directory")
    .option("--source <ref>", "Source/provenance reference", collectValues, [])
    .option("--confidence <number>", "Confidence score from 0 to 1")
    .option("--expires-at <iso>", "Timestamp after which the fact is hidden by default")
    .option("--created-by <id>", "Creator id")
    .option("--task <id>", "Source task id")
    .option("--actor <id>", "RBAC subject for memory writes", "local-admin")
    .action(
      async (options: {
        cwd?: string;
        scope: string;
        type: string;
        content: string;
        source: string[];
        confidence?: string;
        expiresAt?: string;
        createdBy?: string;
        task?: string;
        actor: string;
      }) => {
        await requireRbacPermission({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          actor: options.actor,
          permission: "memory.write",
          action: "write memory"
        });

        const { quarantineMemoryCandidate } = await import("../memory.js");
        const confidence = parseOptionalFloat(options.confidence, "--confidence");
        const result = quarantineMemoryCandidate({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          scope: options.scope,
          type: options.type,
          content: options.content,
          sourceRefs: options.source,
          ...(confidence === undefined ? {} : { confidence }),
          ...(options.expiresAt === undefined
            ? {}
            : {
                expiresAt: parseDateOption(
                  options.expiresAt,
                  "--expires-at"
                ).toISOString()
              }),
          ...(options.createdBy === undefined ? {} : { createdBy: options.createdBy }),
          ...(options.task === undefined ? {} : { taskId: options.task })
        });

        console.log(`Quarantined memory: ${result.memory.id}`);
        console.log(`Scope: ${result.memory.scope}`);
        console.log(`Type: ${result.memory.type}`);
      }
    );
}
