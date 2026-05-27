import { parseOptionalInteger } from "../cli-parsers.js";
import { requireRbacPermission } from "../cli-rbac.js";

export interface MemoryFactListCommandOptions {
  cwd?: string;
  scope?: string;
  includeExpired?: boolean;
  actor: string;
}

export interface MemoryFactSearchCommandOptions {
  cwd?: string;
  scope?: string;
  query?: string;
  limit?: string;
  includeConflicted?: boolean;
  includeExpired?: boolean;
  actor: string;
}

export async function runMemoryFactListCommand(
  options: MemoryFactListCommandOptions
): Promise<void> {
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

  printProjectFacts(result.facts);
}

export async function runMemoryFactSearchCommand(
  options: MemoryFactSearchCommandOptions
): Promise<void> {
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
  printProjectFacts(result.facts);
}

interface PrintableProjectFact {
  id: string;
  scope: string;
  confidence: number;
  content: string;
}

function printProjectFacts(facts: PrintableProjectFact[]): void {
  if (facts.length === 0) {
    console.log("No project facts found.");
    return;
  }

  for (const fact of facts) {
    console.log(
      `${fact.id} ${fact.scope} confidence=${fact.confidence}: ${fact.content}`
    );
  }
}
