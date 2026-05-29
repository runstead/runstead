import type { Command } from "commander";

import { parseOptionalInteger } from "../cli-parsers.js";
import { requireRbacPermission } from "../cli-rbac.js";

export interface LearningProposalsCommandOptions {
  cwd?: string;
  scope?: string;
  type?: string;
  limit?: string;
  json?: boolean;
  actor: string;
}

export function registerLearningCommand(program: Command): Command {
  const learning = program
    .command("learning")
    .description("Review and promote governed learning proposals. Experimental.");

  learning
    .command("proposals")
    .description("List quarantined learning proposals.")
    .option("--cwd <path>", "Workspace directory")
    .option("--scope <scope>", "Filter by memory scope")
    .option("--type <type>", "Filter by memory type")
    .option("--limit <number>", "Maximum proposals to print")
    .option("--json", "Print JSON")
    .option("--actor <id>", "RBAC subject for learning review", "local-admin")
    .action((options: LearningProposalsCommandOptions) =>
      runLearningProposalsCommand(options)
    );

  return learning;
}

export async function runLearningProposalsCommand(
  options: LearningProposalsCommandOptions
): Promise<void> {
  await requireRbacPermission({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    actor: options.actor,
    permission: "memory.read",
    action: "review learning proposals"
  });

  const { formatLearningProposals, listLearningProposals } =
    await import("../learning-proposals.js");
  const limit = parseOptionalInteger(options.limit, "--limit");
  const result = listLearningProposals({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    ...(options.scope === undefined ? {} : { scope: options.scope }),
    ...(options.type === undefined ? {} : { type: options.type }),
    ...(limit === undefined ? {} : { limit })
  });

  if (options.json === true) {
    console.log(JSON.stringify(result.proposals, null, 2));
    return;
  }

  console.log(formatLearningProposals(result.proposals));
}
