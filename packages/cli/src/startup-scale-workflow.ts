import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  formatDelegationPolicy,
  formatIntegrationMap,
  formatWorkflowRegistry
} from "./startup-automation-format.js";
import { requireRunsteadStateDb } from "./runstead-root.js";
import { writeStartupStructuredArtifact } from "./startup-artifacts.js";
import { addStartupEvidence } from "./startup-evidence.js";
import type {
  GenerateIntegrationMapOptions,
  GenerateIntegrationMapResult,
  GenerateWorkflowRegistryOptions,
  GenerateWorkflowRegistryResult
} from "./startup-automation-types.js";

export {
  captureInstitutionalMemory,
  retrieveStartupInstitutionalMemory
} from "./startup-scale-memory.js";

export async function generateWorkflowRegistry(
  options: GenerateWorkflowRegistryOptions = {}
): Promise<GenerateWorkflowRegistryResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const state = await requireRunsteadStateDb(cwd);
  const generatedAt = (options.now ?? new Date()).toISOString();
  const workflows =
    options.workflows === undefined || options.workflows.length === 0
      ? [
          "No recurring workflow input recorded; inventory recurring ops before delegation."
        ]
      : options.workflows;
  const delegationRules =
    options.delegationRules === undefined || options.delegationRules.length === 0
      ? [
          "Read-only inspection and report drafting may run without approval.",
          "External writes, publishing, billing, compliance, and production changes require approval."
        ]
      : options.delegationRules;
  const approvalBoundaries =
    options.approvalBoundaries === undefined || options.approvalBoundaries.length === 0
      ? ["publish", "external_write", "protected_path", "dependency_change"]
      : options.approvalBoundaries;
  const allowedAgents =
    options.allowedAgents === undefined || options.allowedAgents.length === 0
      ? ["codex_cli", "claude_code"]
      : options.allowedAgents;
  const constrainedTaskTypes =
    options.constrainedTaskTypes === undefined ||
    options.constrainedTaskTypes.length === 0
      ? ["startup_remediation", "run_mvp_verifiers", "startup_scale_report"]
      : options.constrainedTaskTypes;
  const workflowMarkdown = formatWorkflowRegistry({
    generatedAt,
    workflows,
    approvalBoundaries
  });
  const delegationMarkdown = formatDelegationPolicy({
    generatedAt,
    delegationRules,
    approvalBoundaries,
    allowedAgents,
    constrainedTaskTypes
  });

  await mkdir(join(state.root, "startup"), { recursive: true });

  const workflowPath = join(state.root, "startup", "workflow-registry.md");
  const delegationPath = join(state.root, "startup", "delegation-policy.md");

  await writeFile(workflowPath, workflowMarkdown, "utf8");
  await writeFile(delegationPath, delegationMarkdown, "utf8");
  const workflowStructuredPath = await writeStartupStructuredArtifact({
    kind: "startup_workflow_registry",
    generatedAt,
    markdownPath: workflowPath,
    data: {
      workflows,
      approvalBoundaries,
      constrainedTaskTypes
    }
  });
  const delegationStructuredPath = await writeStartupStructuredArtifact({
    kind: "startup_delegation_policy",
    generatedAt,
    markdownPath: delegationPath,
    data: {
      delegationRules,
      approvalBoundaries,
      allowedAgents,
      constrainedTaskTypes
    }
  });
  const structuredFiles = [workflowStructuredPath, delegationStructuredPath];

  const workflowEvidence = await addStartupEvidence({
    cwd,
    type: "workflow_registry",
    summary: `Workflow registry recorded (${workflows.length} workflow${workflows.length === 1 ? "" : "s"})`,
    sourceRefs: [workflowPath, workflowStructuredPath, delegationPath],
    content: workflowMarkdown,
    ...(options.now === undefined ? {} : { now: options.now })
  });
  const delegationEvidence = await addStartupEvidence({
    cwd,
    type: "delegation_policy",
    summary: `Delegation policy recorded (${delegationRules.length} rule${delegationRules.length === 1 ? "" : "s"})`,
    sourceRefs: [delegationPath, delegationStructuredPath, workflowPath],
    content: JSON.stringify(
      {
        markdown: delegationMarkdown,
        delegationRules,
        approvalBoundaries,
        allowedAgents,
        constrainedTaskTypes
      },
      null,
      2
    ),
    ...(options.now === undefined ? {} : { now: options.now })
  });

  return {
    root: state.root,
    stateDb: state.stateDb,
    files: [workflowPath, delegationPath],
    structuredFiles,
    evidenceIds: [workflowEvidence.evidence.id, delegationEvidence.evidence.id],
    workflows,
    delegationRules
  };
}

export async function generateIntegrationMap(
  options: GenerateIntegrationMapOptions = {}
): Promise<GenerateIntegrationMapResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const state = await requireRunsteadStateDb(cwd);
  const generatedAt = (options.now ?? new Date()).toISOString();
  const integrations =
    options.integrations === undefined || options.integrations.length === 0
      ? [
          "No integration input recorded; map customer workflow integrations before scale."
        ]
      : options.integrations;
  const markdown = formatIntegrationMap({
    generatedAt,
    integrations,
    lockInSignals: options.lockInSignals ?? [],
    automationCoverage: options.automationCoverage ?? [],
    adoptionSignals: options.adoptionSignals ?? [],
    workflowSignals: options.workflowSignals ?? []
  });

  await mkdir(join(state.root, "startup"), { recursive: true });

  const runtimePath = join(state.root, "startup", "integration-depth-map.md");

  await writeFile(runtimePath, markdown, "utf8");
  const structuredFiles = [
    await writeStartupStructuredArtifact({
      kind: "startup_integration_map",
      generatedAt,
      markdownPath: runtimePath,
      data: {
        integrations,
        lockInSignals: options.lockInSignals ?? [],
        automationCoverage: options.automationCoverage ?? [],
        adoptionSignals: options.adoptionSignals ?? [],
        workflowSignals: options.workflowSignals ?? []
      }
    })
  ];

  const evidence = await addStartupEvidence({
    cwd,
    type: "integration_map",
    summary: `Integration depth map recorded (${integrations.length} integration${integrations.length === 1 ? "" : "s"})`,
    sourceRefs: [runtimePath, ...structuredFiles],
    content: JSON.stringify(
      {
        markdown,
        integrations,
        lockInSignals: options.lockInSignals ?? [],
        automationCoverage: options.automationCoverage ?? [],
        adoptionSignals: options.adoptionSignals ?? [],
        workflowSignals: options.workflowSignals ?? []
      },
      null,
      2
    ),
    ...(options.now === undefined ? {} : { now: options.now })
  });

  return {
    root: state.root,
    stateDb: state.stateDb,
    files: [runtimePath],
    structuredFiles,
    evidenceId: evidence.evidence.id,
    integrations
  };
}
