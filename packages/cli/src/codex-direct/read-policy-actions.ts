import type { ActionEnvelope } from "../policy.js";

import { stableActionId } from "./tool-action-id.js";

export { gitReadAction } from "./git-read-policy-actions.js";

export function filesystemReadAction(input: {
  cwd: string;
  actionType:
    | "filesystem.list"
    | "filesystem.search"
    | "filesystem.read"
    | "filesystem.stat";
  path: string;
  filesTouched?: string[];
  stableParts: unknown[];
}): ActionEnvelope {
  return {
    actionId: stableActionId(input.actionType, input.stableParts),
    actionType: input.actionType,
    resource: {
      type: "directory",
      path: input.path
    },
    context: {
      cwd: input.cwd,
      ...(input.filesTouched === undefined ? {} : { filesTouched: input.filesTouched })
    }
  };
}

export function repositoryMetadataReadAction(input: {
  cwd: string;
  path: string;
}): ActionEnvelope {
  return {
    actionId: stableActionId("repo.metadata.read", [input.cwd, input.path]),
    actionType: "repo.metadata.read",
    resource: {
      type: "package_manifest",
      path: input.path
    },
    context: {
      cwd: input.cwd,
      filesTouched: [
        input.path === "." ? "package.json" : `${input.path}/package.json`,
        input.path === "."
          ? "pnpm-workspace.yaml"
          : `${input.path}/pnpm-workspace.yaml`,
        input.path === "." ? "turbo.json" : `${input.path}/turbo.json`
      ]
    }
  };
}

export function evidenceReadAction(input: {
  cwd: string;
  evidenceId: string;
}): ActionEnvelope {
  return {
    actionId: stableActionId("evidence.read", [input.cwd, input.evidenceId]),
    actionType: "evidence.read",
    resource: {
      type: "evidence",
      id: input.evidenceId
    },
    context: {
      cwd: input.cwd
    }
  };
}

export function workspaceFactsReadAction(input: {
  cwd: string;
  refresh: boolean;
}): ActionEnvelope {
  return {
    actionId: stableActionId("workspace.facts.read", [input.cwd, input.refresh]),
    actionType: "workspace.facts.read",
    resource: {
      type: "repository",
      id: input.cwd
    },
    context: {
      cwd: input.cwd
    }
  };
}
