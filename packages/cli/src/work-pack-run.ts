import { join } from "node:path";

import {
  domainPackRegistryEntryToWorkPack,
  resolveDomainPackRef,
  type DomainPackRegistryEntry,
  type WorkPack,
  type WorkPackWorkflow
} from "@runstead/domain-packs";

import { resolveRunsteadRootSync } from "./runstead-root.js";

export interface ResolveWorkPackWorkflowRunOptions {
  pack: string;
  workflow: string;
  cwd?: string;
  roots?: string[];
  includeBuiltIns?: boolean;
}

export interface WorkPackWorkflowRunPlan {
  entry: DomainPackRegistryEntry;
  workPack: WorkPack;
  workflow: WorkPackWorkflow;
  evidenceContract?: {
    workflow: string;
    outputs: string[];
    completionCriteria: string[];
  };
  suggestedCommands: string[];
}

export async function resolveWorkPackWorkflowRun(
  options: ResolveWorkPackWorkflowRunOptions
): Promise<WorkPackWorkflowRunPlan> {
  const roots = [...(options.roots ?? [])];
  const cwd = options.cwd ?? process.cwd();

  roots.push(join(resolveRunsteadRootSync(cwd).root, "domains"));

  const entry = await resolveDomainPackRef(options.pack, {
    roots,
    ...(options.includeBuiltIns === undefined
      ? {}
      : { includeBuiltIns: options.includeBuiltIns })
  });
  const workPack = domainPackRegistryEntryToWorkPack(entry);
  const workflow = workPack.workflows.find(
    (candidate) => candidate.id === options.workflow
  );

  if (workflow === undefined) {
    throw new Error(
      `Workflow ${options.workflow} is not declared by pack ${entry.id}. Expected one of: ${workPack.workflows
        .map((candidate) => candidate.id)
        .join(", ")}`
    );
  }

  const evidenceContract = entry.domain.evidenceContracts?.find(
    (contract) => contract.workflow === options.workflow
  );

  return {
    entry,
    workPack,
    workflow,
    ...(evidenceContract === undefined ? {} : { evidenceContract }),
    suggestedCommands: suggestedCommandsForWorkflow({
      pack: entry.id,
      workflow: options.workflow,
      cwd
    })
  };
}

export function formatWorkPackWorkflowRunPlan(
  plan: WorkPackWorkflowRunPlan
): string {
  const capabilityPolicy = plan.entry.domain.capabilityPolicy;

  return [
    "Runstead work pack run",
    `Pack: ${plan.workPack.id}`,
    `Name: ${plan.workPack.name}`,
    `Workflow: ${plan.workflow.id}`,
    `Workflow kind: ${plan.workflow.kind}`,
    `Source: ${plan.entry.source}`,
    `Root: ${plan.entry.root}`,
    `Capability reads: ${formatList(capabilityPolicy?.reads ?? [])}`,
    `Capability writes: ${formatList(capabilityPolicy?.writes ?? [])}`,
    `Capability approvals: ${formatList(capabilityPolicy?.approvalsRequired ?? [])}`,
    `Capability denied: ${formatList(capabilityPolicy?.denied ?? [])}`,
    `Evidence outputs: ${formatList(plan.evidenceContract?.outputs ?? [])}`,
    `Completion criteria: ${formatList(plan.evidenceContract?.completionCriteria ?? [])}`,
    `Suggested commands: ${formatList(plan.suggestedCommands)}`
  ].join("\n");
}

function suggestedCommandsForWorkflow(input: {
  pack: string;
  workflow: string;
  cwd: string;
}): string[] {
  if (input.pack === "ai-native-startup" && input.workflow === "build-mvp") {
    return [
      `runstead startup ready --cwd ${input.cwd} --stage launch --target local --worker codex_cli --governance readiness`
    ];
  }

  if (input.pack === "repo-maintenance") {
    return [`runstead run --once --cwd ${input.cwd}`];
  }

  return [
    `runstead domain show ${input.pack} --cwd ${input.cwd}`
  ];
}

function formatList(values: string[]): string {
  if (values.length === 0) {
    return "0";
  }

  return `${values.length} (${values.join(", ")})`;
}
