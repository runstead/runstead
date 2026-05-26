import { collectRepoInspection } from "./inspection-evidence.js";
import type { RunLocalAgentTaskResult } from "./local-agent.js";
import type { StartupDependencyApprovalBoundary } from "./startup-dependency-approval.js";
import type { StartupMvpVerifierRun } from "./startup-founder-flow.js";
import type { StartupScaffoldProfile } from "./startup-scaffold-profile.js";

const DEFAULT_STARTUP_BUILD_MVP_MAX_TURNS = 24;

export async function startupBuildMvpPromptWithDependencyBoundary(input: {
  cwd: string;
  prompt?: string;
  scaffoldProfile?: StartupScaffoldProfile;
  dependencyApproval: StartupDependencyApprovalBoundary;
}): Promise<string> {
  return [
    input.prompt ?? (await defaultBuildMvpPrompt(input.cwd)),
    ...startupScaffoldProfilePromptLines(input.scaffoldProfile),
    "",
    "Dependency approval boundary:",
    input.dependencyApproval.workerInstruction
  ].join("\n");
}

export function verifierRunFromLocalAgentRun(
  run: RunLocalAgentTaskResult
): StartupMvpVerifierRun {
  if (run.verifierResults === undefined) {
    return {
      status: "skipped",
      reason: `worker finished with status ${run.status}`
    };
  }

  const hasFailure = run.verifierResults.some(
    (result) => result.exitCode !== 0 || result.timedOut
  );

  return {
    status: hasFailure ? "failed" : "completed",
    taskId: run.task.id,
    commandResults: run.verifierResults
  };
}

export function startupMvpVerifierRunPassed(run: StartupMvpVerifierRun): boolean {
  return (
    run.status === "completed" &&
    run.commandResults.every(
      (result) => result.exitCode === 0 && result.timedOut === false
    )
  );
}

export function startupBuildMvpRetryPrompt(input: {
  basePrompt: string;
  attempt: number;
  maxAttempts: number;
  verifierRun: StartupMvpVerifierRun;
}): string {
  return [
    input.basePrompt,
    "",
    `Previous MVP build attempt ${input.attempt}/${input.maxAttempts} did not satisfy the verifier contract.`,
    "Use the verifier evidence below as the repair target. Do not broaden scope.",
    "",
    "Verifier evidence:",
    ...startupMvpVerifierEvidenceLines(input.verifierRun)
  ].join("\n");
}

export function normalizeStartupBuildMvpMaxAttempts(value: number | undefined): number {
  if (value === undefined) {
    return 2;
  }

  if (!Number.isInteger(value) || value < 1 || value > 5) {
    throw new Error("Startup MVP maxAttempts must be an integer between 1 and 5");
  }

  return value;
}

export function normalizeStartupBuildMvpMaxTurns(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_STARTUP_BUILD_MVP_MAX_TURNS;
  }

  if (!Number.isInteger(value) || value < 1 || value > 100) {
    throw new Error("Startup MVP maxTurns must be an integer between 1 and 100");
  }

  return value;
}

export async function verifierCommands(cwd: string, now?: Date) {
  const inspection = await collectRepoInspection(
    cwd,
    (now ?? new Date()).toISOString()
  );
  const packageManager = inspection.packageManager.packageManager ?? "npm";

  return [
    commandVerifier("test", inspection.commands.test.command, `${packageManager} test`),
    commandVerifier(
      "lint",
      inspection.commands.lint.command,
      `${packageManager} run lint`
    ),
    commandVerifier(
      "typecheck",
      inspection.commands.typecheck.command,
      `${packageManager} run typecheck`
    ),
    commandVerifier(
      "build",
      inspection.commands.build.command,
      `${packageManager} run build`
    )
  ];
}

function startupScaffoldProfilePromptLines(
  profile: StartupScaffoldProfile | undefined
): string[] {
  if (profile === undefined) {
    return [];
  }

  return [
    "",
    "Scaffold profile:",
    `- id: ${profile.id}`,
    `- title: ${profile.title}`,
    ...(profile.template === undefined ? [] : [`- app_template: ${profile.template}`]),
    ...(profile.appType === undefined ? [] : [`- app_type: ${profile.appType}`]),
    `- app_owned_paths: ${profile.appOwnedPaths.join(", ")}`,
    ...profile.promptLines.map((line) => `- ${line}`)
  ];
}

function startupMvpVerifierEvidenceLines(run: StartupMvpVerifierRun): string[] {
  if (run.status === "skipped") {
    return [`- skipped: ${run.reason}`];
  }

  return run.commandResults.map((result) =>
    [
      `- ${result.verifier}:`,
      `exit=${result.exitCode ?? "null"}`,
      `timed_out=${result.timedOut}`,
      `evidence=${result.evidenceId}`
    ].join(" ")
  );
}

async function defaultBuildMvpPrompt(cwd: string): Promise<string> {
  const inspection = await collectRepoInspection(cwd, new Date().toISOString());

  return [
    "Build or repair the AI-coded MVP for this repository.",
    "Use the existing framework and keep the implementation scoped to the product surface.",
    "Make the verifier commands pass and record launch-relevant evidence when appropriate.",
    "",
    "Detected verifier contract:",
    ...verifierContractLines(inspection)
  ].join("\n");
}

function commandVerifier(
  name: string,
  command: string | undefined,
  fallbackCommand: string
): { name: string; command: string } {
  return {
    name,
    command: command ?? fallbackCommand
  };
}

function verifierContractLines(
  inspection: Awaited<ReturnType<typeof collectRepoInspection>>
): string[] {
  return [
    `- test: ${inspection.commands.test.command ?? "missing"}`,
    `- lint: ${inspection.commands.lint.command ?? "missing"}`,
    `- typecheck: ${inspection.commands.typecheck.command ?? "missing"}`,
    `- build: ${inspection.commands.build.command ?? "missing"}`
  ];
}
