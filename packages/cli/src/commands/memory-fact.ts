import type { Command } from "commander";

import { collectValues } from "../cli-parsers.js";
import {
  runMemoryFactAddCommand,
  runMemoryFactListCommand,
  runMemoryFactSearchCommand,
  type MemoryFactAddCommandOptions,
  type MemoryFactListCommandOptions,
  type MemoryFactSearchCommandOptions
} from "./memory-fact-actions.js";

export function registerMemoryFactCommands(memory: Command): Command {
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
    .action((options: MemoryFactAddCommandOptions) => runMemoryFactAddCommand(options));

  memoryFact
    .command("list")
    .description("List verified project facts.")
    .option("--cwd <path>", "Workspace directory")
    .option("--scope <scope>", "Filter by memory scope")
    .option("--include-expired", "Include expired project facts")
    .option("--actor <id>", "RBAC subject for memory access", "local-admin")
    .action((options: MemoryFactListCommandOptions) =>
      runMemoryFactListCommand(options)
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
    .action((options: MemoryFactSearchCommandOptions) =>
      runMemoryFactSearchCommand(options)
    );

  return memoryFact;
}
