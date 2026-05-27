import { requireRbacPermission } from "../cli-rbac.js";

import { logStructuredFiles } from "./startup-scale-output.js";

export interface StartupScaleStarterPackCommandOptions {
  cwd?: string;
  owner?: string;
  actor: string;
}

export interface StartupScaleWorkflowRegistryCommandOptions {
  cwd?: string;
  workflow: string[];
  delegationRule: string[];
  approvalBoundary: string[];
  allowedAgent: string[];
  constrainedTask: string[];
  actor: string;
}

export interface StartupScaleIntegrationMapCommandOptions {
  cwd?: string;
  integration: string[];
  lockInSignal: string[];
  adoptionSignal: string[];
  workflowSignal: string[];
  automationCoverage: string[];
  actor: string;
}

export async function runStartupScaleStarterPackCommand(
  options: StartupScaleStarterPackCommandOptions
): Promise<void> {
  await requireRbacPermission({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    actor: options.actor,
    permission: "evidence.write",
    action: "generate startup scale starter pack"
  });

  const { generateScaleStarterPack } = await import("../startup-automation.js");
  const result = await generateScaleStarterPack({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    ...(options.owner === undefined ? {} : { owner: options.owner })
  });

  console.log(`Generated scale starter evidence: ${result.evidenceIds[0]}`);
  console.log(`Scale-ready: ${result.scaleReady ? "yes" : "no"}`);
  console.log(`Blockers: ${result.blockers.length}`);
  for (const file of result.files) {
    console.log(`Wrote scale starter file: ${file}`);
  }
  logStructuredFiles(result.structuredFiles);
}

export async function runStartupScaleWorkflowRegistryCommand(
  options: StartupScaleWorkflowRegistryCommandOptions
): Promise<void> {
  await requireRbacPermission({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    actor: options.actor,
    permission: "evidence.write",
    action: "generate startup workflow registry"
  });

  const { generateWorkflowRegistry } = await import("../startup-automation.js");
  const result = await generateWorkflowRegistry({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    workflows: options.workflow,
    delegationRules: options.delegationRule,
    approvalBoundaries: options.approvalBoundary,
    allowedAgents: options.allowedAgent,
    constrainedTaskTypes: options.constrainedTask
  });

  console.log(`Generated workflow evidence: ${result.evidenceIds.join(", ")}`);
  console.log(`Workflows: ${result.workflows.length}`);
  console.log(`Delegation rules: ${result.delegationRules.length}`);
  for (const file of result.files) {
    console.log(`Wrote scale artifact: ${file}`);
  }
  logStructuredFiles(result.structuredFiles);
}

export async function runStartupScaleIntegrationMapCommand(
  options: StartupScaleIntegrationMapCommandOptions
): Promise<void> {
  await requireRbacPermission({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    actor: options.actor,
    permission: "evidence.write",
    action: "generate startup integration depth map"
  });

  const { generateIntegrationMap } = await import("../startup-automation.js");
  const result = await generateIntegrationMap({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    integrations: options.integration,
    lockInSignals: options.lockInSignal,
    automationCoverage: options.automationCoverage,
    adoptionSignals: options.adoptionSignal,
    workflowSignals: options.workflowSignal
  });

  console.log(`Generated integration map evidence: ${result.evidenceId}`);
  console.log(`Integrations: ${result.integrations.length}`);
  for (const file of result.files) {
    console.log(`Wrote integration map file: ${file}`);
  }
  logStructuredFiles(result.structuredFiles);
}
