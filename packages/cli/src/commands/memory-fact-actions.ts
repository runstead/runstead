import { parseOptionalFloat } from "../cli-parsers.js";
import { requireRbacPermission } from "../cli-rbac.js";

export {
  runMemoryFactListCommand,
  runMemoryFactSearchCommand
} from "./memory-fact-read-actions.js";
export type {
  MemoryFactListCommandOptions,
  MemoryFactSearchCommandOptions
} from "./memory-fact-read-actions.js";

export interface MemoryFactAddCommandOptions {
  cwd?: string;
  scope: string;
  content: string;
  source: string[];
  confidence?: string;
  createdBy?: string;
  task?: string;
  actor: string;
}

export async function runMemoryFactAddCommand(
  options: MemoryFactAddCommandOptions
): Promise<void> {
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
