#!/usr/bin/env node
import { basename } from "node:path";
import { Command } from "commander";
import { pathToFileURL } from "node:url";

import { formatCliError } from "./cli-errors.js";
import { registerApprovalCommand } from "./commands/approval.js";
import { registerAgentCommand } from "./commands/agent.js";
import { registerAuditCommand } from "./commands/audit.js";
import { registerCheckpointCommand } from "./commands/checkpoint.js";
import { registerCiRepairCommand } from "./commands/ci-repair.js";
import { registerCodexCommand } from "./commands/codex.js";
import { registerConfigCommand } from "./commands/config.js";
import { registerConnectorCommand } from "./commands/connector.js";
import { registerCoreCommands } from "./commands/core.js";
import { registerDaemonCommand } from "./commands/daemon.js";
import { registerDashboardCommand } from "./commands/dashboard.js";
import { registerDoctorCommand } from "./commands/doctor.js";
import { registerDomainCommand } from "./commands/domain.js";
import { registerGitCommand } from "./commands/git.js";
import { registerGitHubCommand } from "./commands/github.js";
import { registerGoalCommand } from "./commands/goal.js";
import { registerLearningCommand } from "./commands/learning.js";
import { registerMemoryCommand } from "./commands/memory.js";
import { registerMigrateCommand } from "./commands/migrate.js";
import { registerOpsCommand } from "./commands/ops.js";
import { registerPolicyCommand } from "./commands/policy.js";
import { registerRbacCommand } from "./commands/rbac.js";
import { registerRepoCommand } from "./commands/repo.js";
import { registerReportCommand } from "./commands/report.js";
import { registerResumeCommand } from "./commands/resume.js";
import { registerRunCommand } from "./commands/run.js";
import { registerSchedulerCommand } from "./commands/scheduler.js";
import { registerSkillCommand } from "./commands/skill.js";
import { registerTaskCommand } from "./commands/task.js";
import { registerTeamControlPlaneCommand } from "./commands/team-control-plane.js";
import { registerTeamPolicyCommand } from "./commands/team-policy.js";
import { registerVerifierCommand } from "./commands/verifier.js";
import { registerWebhookCommand } from "./commands/webhook.js";
import { registerStartupCommands } from "./startup-command.js";

export {
  createStartupReadinessClient,
  ingestStartupWebhookEvidence,
  startupApiSnapshot
} from "./startup-sdk.js";

export interface CreateProgramOptions {
  entrypoint?: string;
}

export { formatCliError, RunsteadCliError } from "./cli-errors.js";
export {
  formatRunsteadConnector,
  formatRunsteadConnectorList,
  getRunsteadConnector,
  listRunsteadConnectors,
  requireRunsteadConnector
} from "./connector-catalog.js";
export type {
  RunsteadConnectorDefinition,
  RunsteadConnectorId,
  RunsteadConnectorMaturity
} from "./connector-catalog.js";
export {
  collectValues,
  parseCiRepairWorkerKind,
  parseDateOption,
  parseOptionalFloat,
  parseOptionalInteger,
  parseRequiredInteger,
  parseRequiredPositiveInteger
} from "./cli-parsers.js";
export { requireSecretPrintAcknowledgement } from "./cli-secrets.js";
export { requireUnmanagedHelperAcknowledgement } from "./cli-unmanaged.js";
export { requireVerifierCommandOptions } from "./verifier-command-options.js";
export {
  localAgentPresetRunsVerifiersFirst,
  resolvePresetVerifierCommandOptions
} from "./local-agent-verifier-options.js";

export async function runCli(argv = process.argv): Promise<void> {
  try {
    await createProgram({
      ...(argv[1] === undefined ? {} : { entrypoint: argv[1] })
    }).parseAsync(argv);
  } catch (error) {
    console.error(
      formatCliError(error, {
        debug: process.env.RUNSTEAD_DEBUG === "1"
      })
    );
    process.exitCode = 1;
  }
}

export function createProgram(options: CreateProgramOptions = {}): Command {
  const program = new Command();

  program
    .name(inferProgramName(options.entrypoint ?? process.argv[1]))
    .description("Control plane for long-running autonomous work agents.")
    .version("0.0.0");

  registerCiRepairCommand(program);
  registerCodexCommand(program);
  registerConfigCommand(program);
  registerConnectorCommand(program);
  registerAgentCommand(program);
  registerDashboardCommand(program);
  registerDoctorCommand(program);
  registerTeamControlPlaneCommand(program);
  registerCoreCommands(program);
  registerResumeCommand(program);
  registerOpsCommand(program);
  registerCheckpointCommand(program);
  registerMigrateCommand(program);
  registerRunCommand(program);
  registerDaemonCommand(program);
  registerSchedulerCommand(program);
  registerRbacCommand(program);
  registerTeamPolicyCommand(program);
  registerAuditCommand(program);
  registerReportCommand(program);
  registerWebhookCommand(program);
  registerLearningCommand(program);
  registerMemoryCommand(program);
  registerSkillCommand(program);
  registerRepoCommand(program);
  registerDomainCommand(program);
  registerGoalCommand(program);
  registerTaskCommand(program);
  registerApprovalCommand(program);
  registerVerifierCommand(program);
  registerGitCommand(program);
  registerPolicyCommand(program);
  registerGitHubCommand(program);

  registerStartupCommands(program);

  return program;
}

export function inferProgramName(entrypoint?: string): "runstead" | "team" {
  return entrypoint !== undefined && basename(entrypoint) === "team"
    ? "team"
    : "runstead";
}

const entrypoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : undefined;

if (entrypoint === import.meta.url) {
  await runCli(process.argv);
}
