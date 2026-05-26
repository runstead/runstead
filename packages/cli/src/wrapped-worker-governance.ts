import type { Goal, Task } from "@runstead/core";

export type WrappedWorkerKind = "claude_code" | "codex_cli";
export type WrappedWorkerInternalToolProxyMode = "none" | "hard_proxy";

export interface WrappedWorkerPromptInput {
  worker: WrappedWorkerKind;
  goal: Goal;
  task: Task;
  workspace: string;
  evidenceDir: string;
  policySummary?: string;
  allowedScope?: string[];
  deniedActions?: string[];
  approvalRequired?: string[];
  verifierContract?: string[];
  instructions?: string[];
  requiredInternalToolProxy?: WrappedWorkerInternalToolProxyMode;
}

export interface WrappedWorkerGovernanceManifest {
  worker: WrappedWorkerKind;
  taskId: string;
  goalId: string;
  domain: string;
  workspace: string;
  evidenceDir: string;
  enforcement: "policy_gated_wrapper";
  capabilities: WrappedWorkerEnforcementCapabilities;
  internalToolProxy: WrappedWorkerInternalToolProxyStatus;
  enforcementNotes: string[];
  allowedScope: string[];
  deniedActions: string[];
  approvalRequired: string[];
  verifierContract: string[];
  launchGuardrails: WrappedWorkerLaunchGuardrails;
}

export interface WrappedWorkerEnforcementCapabilities {
  launchPolicyGate: boolean;
  workerNativeGuardrails: boolean;
  workspaceCheckpoint: boolean;
  postRunDiffVerification: boolean;
  hardProxyToolCalls: boolean;
}

export interface WrappedWorkerInternalToolProxyStatus {
  mode: "none";
  required: WrappedWorkerInternalToolProxyMode;
  hardProxyAvailable: boolean;
}

export interface WrappedWorkerLaunchGuardrails {
  worker: WrappedWorkerKind;
  sandboxMode?: "workspace-write";
  permissionMode?: "default";
  disallowedTools: string[];
}

export class WrappedWorkerHardProxyUnavailableError extends Error {
  constructor(worker: WrappedWorkerKind) {
    super(`Hard tool proxy enforcement is not available for wrapped worker: ${worker}`);
    this.name = "WrappedWorkerHardProxyUnavailableError";
  }
}

export const CLAUDE_DISALLOWED_TOOLS = [
  "Bash(git push *)",
  "Bash(gh pr create *)",
  "Bash(gh api --method POST *)",
  "Bash(curl *)",
  "Bash(wget *)",
  "Bash(npm install *)",
  "Bash(npm i *)",
  "Bash(pnpm add *)",
  "Bash(yarn add *)",
  "Bash(bun add *)"
];

export function buildWrappedWorkerPrompt(input: WrappedWorkerPromptInput): string {
  const governance = buildWrappedWorkerGovernanceManifest(input);

  return [
    "You are a Runstead worker.",
    "",
    "Goal:",
    `${input.goal.title} (${input.goal.id})`,
    "",
    "Task:",
    `${input.task.type} (${input.task.id})`,
    "",
    "Domain:",
    input.goal.domain,
    "",
    "Workspace:",
    input.workspace,
    "",
    "Evidence directory:",
    input.evidenceDir,
    "",
    "Allowed scope:",
    bulletList(governance.allowedScope),
    "",
    "Denied actions:",
    bulletList(governance.deniedActions),
    "",
    "Approval required for:",
    bulletList(governance.approvalRequired),
    "",
    "Verifier contract:",
    bulletList(governance.verifierContract),
    "",
    "Runstead governance manifest:",
    JSON.stringify(governance, null, 2),
    "",
    "Enforcement boundary:",
    "Runstead policy-gates this worker launch, starts it with worker-native guardrails, and verifies the resulting diff; worker-internal tool calls are not fully hard-proxied in wrapper mode.",
    "",
    ...(input.policySummary === undefined
      ? []
      : ["Policy summary:", input.policySummary, ""]),
    "Rules:",
    "1. Make the smallest safe change.",
    "2. Do not modify denied paths.",
    "3. Do not access secrets.",
    "4. Do not install or upgrade dependencies unless approval is granted.",
    "5. Completion requires Runstead verifier success.",
    "6. Return structured JSON and do not claim success without evidence.",
    "",
    "Output JSON:",
    JSON.stringify(
      {
        summary: "string",
        files_changed: ["string"],
        commands_run: ["string"],
        risks: ["string"],
        needs_approval: false,
        approval_reason: null
      },
      null,
      2
    ),
    ...(input.instructions === undefined || input.instructions.length === 0
      ? []
      : ["", "Additional instructions:", bulletList(input.instructions)])
  ].join("\n");
}

export function buildWrappedWorkerGovernanceManifest(
  input: WrappedWorkerPromptInput
): WrappedWorkerGovernanceManifest {
  const internalToolProxy = buildWrappedWorkerInternalToolProxyStatus(input);

  return {
    worker: input.worker,
    taskId: input.task.id,
    goalId: input.goal.id,
    domain: input.goal.domain,
    workspace: input.workspace,
    evidenceDir: input.evidenceDir,
    enforcement: "policy_gated_wrapper",
    capabilities: {
      launchPolicyGate: true,
      workerNativeGuardrails: true,
      workspaceCheckpoint: true,
      postRunDiffVerification: true,
      hardProxyToolCalls: internalToolProxy.hardProxyAvailable
    },
    internalToolProxy,
    enforcementNotes: [
      "Runstead policy-gates worker launch.",
      "Runstead starts wrapped workers with worker-native sandbox or permission guardrails.",
      "Runstead verifies diff scope and command evidence after the worker exits.",
      "Worker-internal tool calls are not fully hard-proxied in wrapper mode."
    ],
    allowedScope: input.allowedScope ?? ["repository working tree"],
    deniedActions: input.deniedActions ?? ["modify protected paths", "access secrets"],
    approvalRequired: input.approvalRequired ?? [
      "dependency changes",
      "external writes"
    ],
    verifierContract: input.verifierContract ?? input.task.verifiers,
    launchGuardrails: buildWrappedWorkerLaunchGuardrails(input.worker)
  };
}

export function buildWrappedWorkerInternalToolProxyStatus(
  input: Pick<WrappedWorkerPromptInput, "worker" | "requiredInternalToolProxy">
): WrappedWorkerInternalToolProxyStatus {
  const required = input.requiredInternalToolProxy ?? "none";
  const status: WrappedWorkerInternalToolProxyStatus = {
    mode: "none",
    required,
    hardProxyAvailable: false
  };

  if (required === "hard_proxy" && !status.hardProxyAvailable) {
    throw new WrappedWorkerHardProxyUnavailableError(input.worker);
  }

  return status;
}

export function buildWrappedWorkerLaunchGuardrails(
  worker: WrappedWorkerKind
): WrappedWorkerLaunchGuardrails {
  switch (worker) {
    case "claude_code":
      return {
        worker,
        permissionMode: "default",
        disallowedTools: [...CLAUDE_DISALLOWED_TOOLS]
      };
    case "codex_cli":
      return {
        worker,
        sandboxMode: "workspace-write",
        disallowedTools: []
      };
  }
}

function bulletList(values: string[]): string {
  return values.map((value) => `- ${value}`).join("\n");
}
