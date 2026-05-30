import type { Command } from "commander";

import { collectValues, parseOptionalInteger } from "../cli-parsers.js";
import { requireRbacPermission } from "../cli-rbac.js";

export interface LearningProposalsCommandOptions {
  cwd?: string;
  scope?: string;
  type?: string;
  limit?: string;
  json?: boolean;
  actor: string;
}

export interface LearningReviewCommandOptions {
  cwd?: string;
  actor: string;
}

export interface LearningPromoteMemoryCommandOptions {
  cwd?: string;
  promotedBy: string;
  actor: string;
}

export interface LearningCreateSkillCommandOptions {
  cwd?: string;
  name?: string;
  dir?: string;
  domain?: string;
  trigger: string[];
  allowedTool: string[];
  deniedTool: string[];
  verifierCommand: string[];
  author?: string;
  scopeRepo: string[];
  actor: string;
}

export interface LearningAutoImproveCommandOptions {
  cwd?: string;
  scope: string;
  risk: string;
  limit?: string;
  canary?: string;
  shadow?: boolean;
  rollbackOnRegression?: boolean;
  promotedBy: string;
  actor: string;
}

export function registerLearningCommand(program: Command): Command {
  const learning = program
    .command("learning")
    .description("Review and promote governed learning proposals. Experimental.");

  learning
    .command("auto-improve")
    .description(
      "Experimental secondary loop: validate, promote, and repo-scope low-risk skill candidates."
    )
    .option("--cwd <path>", "Workspace directory")
    .option("--scope <scope>", "Activation scope: repo or global", "repo")
    .option("--risk <risk>", "Maximum auto-promotion risk: low, medium, or high", "low")
    .option("--limit <number>", "Maximum skill candidates to evaluate")
    .option("--canary <percent>", "Activation canary percentage from 0 to 100", "100")
    .option("--shadow", "Promote and register in shadow mode without prompt injection")
    .option(
      "--no-rollback-on-regression",
      "Do not auto-disable activated skills when a later task regresses"
    )
    .option("--promoted-by <id>", "Promotion identity", "runstead:auto-improve")
    .option("--actor <id>", "RBAC subject for learning promotion", "local-admin")
    .action((options: LearningAutoImproveCommandOptions) =>
      runLearningAutoImproveCommand(options)
    );

  learning
    .command("review")
    .description("Run post-run learning review for an existing task.")
    .argument("<task-id>", "Task id to review")
    .option("--cwd <path>", "Workspace directory")
    .option("--actor <id>", "RBAC subject for learning review", "local-admin")
    .action((taskId: string, options: LearningReviewCommandOptions) =>
      runLearningReviewCommand(taskId, options)
    );

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

  learning
    .command("promote-memory")
    .description("Promote a quarantined learning proposal to verified memory.")
    .argument("<candidate-id>", "Quarantined memory candidate id")
    .option("--cwd <path>", "Workspace directory")
    .option("--promoted-by <id>", "Promoter identity", "local-admin")
    .option("--actor <id>", "RBAC subject for learning promotion", "local-admin")
    .action((candidateId: string, options: LearningPromoteMemoryCommandOptions) =>
      runLearningPromoteMemoryCommand(candidateId, options)
    );

  learning
    .command("create-skill")
    .description("Create a skill candidate package from a learning proposal.")
    .argument("<candidate-id>", "Quarantined skill_candidate memory id")
    .option("--cwd <path>", "Workspace directory")
    .option("--name <name>", "Skill package name in lowercase kebab-case")
    .option("--dir <path>", "Skill package root directory")
    .option("--domain <domain>", "Skill domain")
    .option("--trigger <trigger>", "Skill trigger", collectValues, [])
    .option("--allowed-tool <tool>", "Allowed tool contract", collectValues, [])
    .option("--denied-tool <tool>", "Denied tool contract", collectValues, [])
    .option("--verifier-command <command>", "Verifier command", collectValues, [])
    .option("--author <id>", "Skill candidate author")
    .option("--scope-repo <repo>", "Scoped repository", collectValues, [])
    .option("--actor <id>", "RBAC subject for learning promotion", "local-admin")
    .action((candidateId: string, options: LearningCreateSkillCommandOptions) =>
      runLearningCreateSkillCommand(candidateId, options)
    );

  return learning;
}

export async function runLearningAutoImproveCommand(
  options: LearningAutoImproveCommandOptions
): Promise<void> {
  await requireRbacPermission({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    actor: options.actor,
    permission: "memory.write",
    action: "experimental auto-improve learning skills"
  });

  const { autoImproveLearning } = await import("../learning-actions.js");
  const limit = parseOptionalInteger(options.limit, "--limit");
  const result = await autoImproveLearning({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    scope: parseAutoImproveScope(options.scope),
    risk: parseAutoImproveRisk(options.risk),
    ...(limit === undefined ? {} : { limit }),
    canaryPercent: parseCanaryPercent(options.canary),
    activationStatus: options.shadow === true ? "shadow" : "active",
    rollbackOnRegression: options.rollbackOnRegression !== false,
    promotedBy: options.promotedBy
  });

  console.log("Experimental learning auto-improve");
  console.log(`Decisions: ${result.decisions.length}`);
  for (const decision of result.decisions) {
    if (decision.status === "promoted") {
      console.log(
        `  promoted ${decision.candidateId} -> ${decision.activation.id} ${decision.activation.status} ${decision.skillRoot}`
      );
    } else {
      console.log(`  skipped ${decision.candidateId}: ${decision.reason}`);
    }
  }
}

export async function runLearningReviewCommand(
  taskId: string,
  options: LearningReviewCommandOptions
): Promise<void> {
  await requireRbacPermission({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    actor: options.actor,
    permission: "memory.write",
    action: "review task learning"
  });

  const { reviewLearningForTask } = await import("../learning-actions.js");
  const result = reviewLearningForTask({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    taskId
  });

  console.log(`Learning review: ${result.review.event.eventId}`);
  console.log(`Candidates quarantined: ${result.review.quarantinedMemories.length}`);
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

export async function runLearningPromoteMemoryCommand(
  candidateId: string,
  options: LearningPromoteMemoryCommandOptions
): Promise<void> {
  await requireRbacPermission({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    actor: options.actor,
    permission: "memory.write",
    action: "promote learning memory"
  });

  const { promoteLearningMemoryCandidate } = await import("../learning-actions.js");
  const result = promoteLearningMemoryCandidate({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    candidateId,
    promotedBy: options.promotedBy
  });

  console.log(`Promoted learning memory: ${result.memory.id}`);
  console.log(`Previous status: ${result.previousStatus}`);
  console.log(`Confidence: ${result.memory.confidence}`);
}

export async function runLearningCreateSkillCommand(
  candidateId: string,
  options: LearningCreateSkillCommandOptions
): Promise<void> {
  await requireRbacPermission({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    actor: options.actor,
    permission: "memory.read",
    action: "create skill from learning proposal"
  });

  const { createSkillFromLearningCandidate } = await import("../learning-actions.js");
  const result = await createSkillFromLearningCandidate({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    candidateId,
    ...(options.name === undefined ? {} : { name: options.name }),
    ...(options.dir === undefined ? {} : { dir: options.dir }),
    ...(options.domain === undefined ? {} : { domain: options.domain }),
    ...(options.trigger.length === 0 ? {} : { triggers: options.trigger }),
    ...(options.allowedTool.length === 0 ? {} : { allowedTools: options.allowedTool }),
    ...(options.deniedTool.length === 0 ? {} : { deniedTools: options.deniedTool }),
    ...(options.verifierCommand.length === 0
      ? {}
      : { verifierCommands: options.verifierCommand }),
    ...(options.author === undefined ? {} : { author: options.author }),
    ...(options.scopeRepo.length === 0 ? {} : { scopeRepos: options.scopeRepo })
  });

  console.log(`Created skill candidate: ${result.skill.root}`);
  console.log(`Source memory: ${result.memory.id}`);
}

function parseAutoImproveScope(value: string): "repo" | "global" {
  if (value === "repo" || value === "global") {
    return value;
  }

  throw new Error("--scope must be repo or global");
}

function parseAutoImproveRisk(value: string): "low" | "medium" | "high" {
  if (value === "low" || value === "medium" || value === "high") {
    return value;
  }

  throw new Error("--risk must be low, medium, or high");
}

function parseCanaryPercent(value: string | undefined): number {
  const parsed = parseOptionalInteger(value ?? "100", "--canary");

  if (parsed === undefined || parsed < 0 || parsed > 100) {
    throw new Error("--canary must be an integer from 0 to 100");
  }

  return parsed;
}
