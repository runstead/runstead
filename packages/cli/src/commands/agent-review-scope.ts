export interface AgentReviewScopeOptions {
  staged?: boolean;
  base?: string;
  unpushed?: boolean;
}

export type LocalAgentReviewScope =
  | {
      kind: "staged" | "unstaged" | "unpushed";
      title: string;
      prompt: string;
      gitDiffInstruction: string;
    }
  | {
      kind: "base";
      base: string;
      title: string;
      prompt: string;
      gitDiffInstruction: string;
    };

export function assertSingleReviewScope(options: AgentReviewScopeOptions): void {
  const scopes = [
    options.staged === true,
    options.base !== undefined,
    options.unpushed === true
  ].filter(Boolean);

  if (scopes.length > 1) {
    throw new Error("agent review accepts only one of --staged, --base, or --unpushed");
  }
}

export function localAgentReviewScope(
  options: AgentReviewScopeOptions
): LocalAgentReviewScope {
  if (options.staged === true) {
    return {
      kind: "staged",
      title: "staged diff",
      prompt: "Review the staged git diff only.",
      gitDiffInstruction: "When calling git_diff, pass staged=true."
    };
  }

  if (options.unpushed === true) {
    return {
      kind: "unpushed",
      title: "unpushed commits",
      prompt: "Review commits ahead of the upstream branch only.",
      gitDiffInstruction:
        "When calling git_diff, pass base='@{upstream}' and leave staged unset."
    };
  }

  if (options.base !== undefined) {
    return {
      kind: "base",
      base: options.base,
      title: `${options.base}...HEAD`,
      prompt: `Review the git diff from ${options.base} to HEAD only.`,
      gitDiffInstruction: `When calling git_diff, pass base='${options.base}' and leave staged unset.`
    };
  }

  return {
    kind: "unstaged",
    title: "unstaged diff",
    prompt: "Review the unstaged git diff only.",
    gitDiffInstruction: "When calling git_diff, leave staged unset or false."
  };
}

export function localAgentReviewPresetId(
  scope: LocalAgentReviewScope
): "review:staged" | "review:unpushed" | "review:diff" {
  if (scope.kind === "staged") {
    return "review:staged";
  }

  if (scope.kind === "unpushed") {
    return "review:unpushed";
  }

  return "review:diff";
}

export function localAgentReviewGitDiffBase(
  scope: LocalAgentReviewScope
): string | undefined {
  if (scope.kind === "base") {
    return scope.base;
  }

  if (scope.kind === "unpushed") {
    return "@{upstream}";
  }

  return undefined;
}
