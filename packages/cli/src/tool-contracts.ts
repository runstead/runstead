export interface ToolContract {
  actionType: string;
  tool: string;
  resourceTypes: string[];
  sideEffects: string[];
  evidenceRequired: boolean;
  policyRequired: boolean;
}

const TOOL_CONTRACTS: ToolContract[] = [
  {
    actionType: "shell.exec",
    tool: "shell",
    resourceTypes: ["process", "repository"],
    sideEffects: ["execute_process", "read_workspace"],
    evidenceRequired: true,
    policyRequired: true
  },
  {
    actionType: "filesystem.read",
    tool: "filesystem",
    resourceTypes: ["file", "directory"],
    sideEffects: ["read_workspace"],
    evidenceRequired: false,
    policyRequired: true
  },
  {
    actionType: "filesystem.list",
    tool: "filesystem",
    resourceTypes: ["directory"],
    sideEffects: ["read_workspace"],
    evidenceRequired: false,
    policyRequired: true
  },
  {
    actionType: "filesystem.search",
    tool: "filesystem",
    resourceTypes: ["directory"],
    sideEffects: ["read_workspace"],
    evidenceRequired: false,
    policyRequired: true
  },
  {
    actionType: "filesystem.stat",
    tool: "filesystem",
    resourceTypes: ["file", "directory"],
    sideEffects: ["read_workspace"],
    evidenceRequired: false,
    policyRequired: true
  },
  {
    actionType: "filesystem.write",
    tool: "filesystem",
    resourceTypes: ["file", "directory"],
    sideEffects: ["write_workspace"],
    evidenceRequired: true,
    policyRequired: true
  },
  {
    actionType: "filesystem.patch",
    tool: "filesystem",
    resourceTypes: ["file", "directory"],
    sideEffects: ["write_workspace"],
    evidenceRequired: true,
    policyRequired: true
  },
  {
    actionType: "git.status",
    tool: "git",
    resourceTypes: ["repository"],
    sideEffects: ["read_workspace"],
    evidenceRequired: false,
    policyRequired: true
  },
  {
    actionType: "git.diff",
    tool: "git",
    resourceTypes: ["repository"],
    sideEffects: ["read_workspace"],
    evidenceRequired: true,
    policyRequired: true
  },
  {
    actionType: "git.branch.create",
    tool: "git",
    resourceTypes: ["branch", "repository"],
    sideEffects: ["write_workspace"],
    evidenceRequired: true,
    policyRequired: true
  },
  {
    actionType: "git.commit",
    tool: "git",
    resourceTypes: ["commit", "repository"],
    sideEffects: ["write_workspace"],
    evidenceRequired: true,
    policyRequired: true
  },
  {
    actionType: "git.push",
    tool: "git",
    resourceTypes: ["branch", "repository"],
    sideEffects: ["network_write_external", "git_push"],
    evidenceRequired: true,
    policyRequired: true
  },
  {
    actionType: "github.run.read",
    tool: "github",
    resourceTypes: ["workflow_run"],
    sideEffects: ["network_read_external"],
    evidenceRequired: true,
    policyRequired: true
  },
  {
    actionType: "github.run.log.read",
    tool: "github",
    resourceTypes: ["workflow_run"],
    sideEffects: ["network_read_external"],
    evidenceRequired: true,
    policyRequired: true
  },
  {
    actionType: "repo.metadata.read",
    tool: "runstead",
    resourceTypes: ["package_manifest", "workspace_config"],
    sideEffects: ["read_workspace"],
    evidenceRequired: false,
    policyRequired: true
  },
  {
    actionType: "verifier.run",
    tool: "runstead",
    resourceTypes: ["verifier", "repository"],
    sideEffects: ["execute_process", "read_workspace"],
    evidenceRequired: true,
    policyRequired: true
  },
  {
    actionType: "package.install",
    tool: "package-manager",
    resourceTypes: ["package_manifest", "lockfile"],
    sideEffects: ["execute_process", "write_workspace", "network_write_external"],
    evidenceRequired: true,
    policyRequired: true
  },
  {
    actionType: "package.update",
    tool: "package-manager",
    resourceTypes: ["package_manifest", "lockfile"],
    sideEffects: ["execute_process", "write_workspace", "network_write_external"],
    evidenceRequired: true,
    policyRequired: true
  },
  {
    actionType: "github.pr.create",
    tool: "github",
    resourceTypes: ["pull_request"],
    sideEffects: ["network_write_external", "github_pr_create"],
    evidenceRequired: true,
    policyRequired: true
  },
  {
    actionType: "repo.publish_repair",
    tool: "runstead",
    resourceTypes: ["pull_request", "branch"],
    sideEffects: ["network_write_external", "git_push", "github_pr_create"],
    evidenceRequired: true,
    policyRequired: true
  },
  {
    actionType: "worker.external.start",
    tool: "worker",
    resourceTypes: ["process", "repository"],
    sideEffects: ["execute_process", "write_workspace"],
    evidenceRequired: true,
    policyRequired: true
  },
  {
    actionType: "worker.native.start",
    tool: "worker",
    resourceTypes: ["process", "repository"],
    sideEffects: ["execute_process", "write_workspace", "governed_tool_proxy"],
    evidenceRequired: true,
    policyRequired: true
  },
  {
    actionType: "model.inference.request",
    tool: "model-provider",
    resourceTypes: ["model_provider", "model"],
    sideEffects: ["network_write_external", "llm_data_egress"],
    evidenceRequired: true,
    policyRequired: true
  },
  {
    actionType: "checkpoint.create",
    tool: "checkpoint",
    resourceTypes: ["repository"],
    sideEffects: ["read_workspace"],
    evidenceRequired: true,
    policyRequired: true
  },
  {
    actionType: "checkpoint.restore",
    tool: "checkpoint",
    resourceTypes: ["repository"],
    sideEffects: ["write_workspace"],
    evidenceRequired: true,
    policyRequired: true
  }
];

export function listToolContracts(): ToolContract[] {
  return TOOL_CONTRACTS.map((contract) => ({
    ...contract,
    resourceTypes: [...contract.resourceTypes],
    sideEffects: [...contract.sideEffects]
  }));
}

export function getToolContract(actionType: string): ToolContract | undefined {
  const contract = TOOL_CONTRACTS.find((item) => item.actionType === actionType);

  if (contract === undefined) {
    return undefined;
  }

  return {
    ...contract,
    resourceTypes: [...contract.resourceTypes],
    sideEffects: [...contract.sideEffects]
  };
}

export function requireToolContract(actionType: string): ToolContract {
  const contract = getToolContract(actionType);

  if (contract === undefined) {
    throw new Error(`Tool contract not found for action type: ${actionType}`);
  }

  return contract;
}
