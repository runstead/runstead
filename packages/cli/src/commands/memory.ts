import type { Command } from "commander";

import {
  collectValues,
  parseDateOption,
  parseOptionalFloat,
  parseOptionalInteger
} from "../cli-parsers.js";
import { requireRbacPermission } from "../cli-rbac.js";

export function registerMemoryCommand(program: Command): Command {
  const memory = program
    .command("memory")
    .description("Manage governed memory. Experimental.");

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

  const memoryFact = memory.command("fact").description("Manage project facts.");

  memoryFact
    .command("add")
    .description("Record a verified project fact from repo file sources.")
    .requiredOption("--scope <scope>", "Memory scope, for example repo:acme/app")
    .requiredOption("--content <text>", "Project fact content")
    .requiredOption("--source <file-ref>", "Trusted file: source", collectValues, [])
    .option("--cwd <path>", "Workspace directory")
    .option("--confidence <number>", "Confidence score from 0 to 1")
    .option("--created-by <id>", "Creator id")
    .option("--task <id>", "Source task id")
    .option("--actor <id>", "RBAC subject for memory writes", "local-admin")
    .action(
      async (options: {
        cwd?: string;
        scope: string;
        content: string;
        source: string[];
        confidence?: string;
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

        const { recordProjectFact } = await import("../memory.js");
        const confidence = parseOptionalFloat(options.confidence, "--confidence");
        const result = recordProjectFact({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          scope: options.scope,
          content: options.content,
          sourceRefs: options.source,
          ...(confidence === undefined ? {} : { confidence }),
          ...(options.createdBy === undefined ? {} : { createdBy: options.createdBy }),
          ...(options.task === undefined ? {} : { taskId: options.task })
        });

        console.log(`Recorded project fact: ${result.memory.id}`);
        console.log(`Scope: ${result.memory.scope}`);
      }
    );

  memoryFact
    .command("list")
    .description("List verified project facts.")
    .option("--cwd <path>", "Workspace directory")
    .option("--scope <scope>", "Filter by memory scope")
    .option("--include-expired", "Include expired project facts")
    .option("--actor <id>", "RBAC subject for memory access", "local-admin")
    .action(
      async (options: {
        cwd?: string;
        scope?: string;
        includeExpired?: boolean;
        actor: string;
      }) => {
        await requireRbacPermission({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          actor: options.actor,
          permission: "memory.read",
          action: "read memory"
        });

        const { listProjectFacts } = await import("../memory.js");
        const result = listProjectFacts({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          ...(options.scope === undefined ? {} : { scope: options.scope }),
          includeExpired: options.includeExpired === true
        });

        if (result.facts.length === 0) {
          console.log("No project facts found.");
          return;
        }

        for (const fact of result.facts) {
          console.log(
            `${fact.id} ${fact.scope} confidence=${fact.confidence}: ${fact.content}`
          );
        }
      }
    );

  memoryFact
    .command("search")
    .description("Retrieve verified project facts and record a retrieval audit event.")
    .option("--cwd <path>", "Workspace directory")
    .option("--scope <scope>", "Filter by memory scope")
    .option("--query <text>", "Search text")
    .option("--limit <number>", "Maximum facts to return")
    .option("--include-conflicted", "Include facts with explicit conflicts")
    .option("--include-expired", "Include expired project facts")
    .option("--actor <id>", "RBAC subject for memory access", "local-admin")
    .action(
      async (options: {
        cwd?: string;
        scope?: string;
        query?: string;
        limit?: string;
        includeConflicted?: boolean;
        includeExpired?: boolean;
        actor: string;
      }) => {
        await requireRbacPermission({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          actor: options.actor,
          permission: "memory.read",
          action: "read memory"
        });

        const { retrieveProjectFacts } = await import("../memory.js");
        const limit = parseOptionalInteger(options.limit, "--limit");
        const result = retrieveProjectFacts({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          ...(options.scope === undefined ? {} : { scope: options.scope }),
          ...(options.query === undefined ? {} : { query: options.query }),
          ...(limit === undefined ? {} : { limit }),
          includeConflicted: options.includeConflicted === true,
          includeExpired: options.includeExpired === true
        });

        console.log(`Retrieval audit: ${result.retrievalId}`);

        if (result.facts.length === 0) {
          console.log("No project facts found.");
          return;
        }

        for (const fact of result.facts) {
          console.log(
            `${fact.id} ${fact.scope} confidence=${fact.confidence}: ${fact.content}`
          );
        }
      }
    );

  return memory;
}
