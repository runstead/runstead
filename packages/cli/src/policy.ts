import { isAbsolute, relative } from "node:path";

export type PolicyDecision = "allow" | "deny" | "require_approval";
export type PolicyRisk = "low" | "medium" | "high" | "critical";

export interface ActionEnvelope {
  actionId: string;
  actionType: string;
  resource?: ActionResource;
  context?: ActionContext;
}

export interface ActionResource {
  type: string;
  id?: string;
  path?: string;
}

export interface ActionContext {
  cwd?: string;
  command?: string;
  filesTouched?: string[];
  networkDomains?: string[];
  secretsRequested?: string[];
  sideEffects?: string[];
}

export interface PolicyProfile {
  id: string;
  version: number;
  defaultDecision?: PolicyDecision;
  defaultRisk?: PolicyRisk;
  rules: PolicyRule[];
}

export interface PolicyRule {
  id: string;
  when: PolicyCondition;
  decision: PolicyDecision;
  risk: PolicyRisk;
  obligations?: string[];
}

export interface PolicyCondition {
  actionType?: string | string[];
  path?: PathMatcherCondition;
  command?: RegexMatcherCondition;
  sideEffects?: SideEffectsCondition;
}

export interface PathMatcherCondition {
  matchesAny: string[];
}

export interface RegexMatcherCondition {
  matchesAny: string[];
}

export interface SideEffectsCondition {
  containsAny: string[];
}

export interface PolicyEvaluationResult {
  actionId: string;
  decision: PolicyDecision;
  risk: PolicyRisk;
  ruleId?: string;
  reason: string;
  obligations: string[];
  matchedPath?: string;
  matchedCommand?: string;
  matchedSideEffect?: string;
}

export interface EvaluatePolicyOptions {
  policy: PolicyProfile;
  action: ActionEnvelope;
}

export const DEFAULT_VERIFIER_COMMAND_PATTERNS = [
  "^pnpm test( .*)?$",
  "^pnpm run lint( .*)?$",
  "^npm test( .*)?$",
  "^npm run lint( .*)?$",
  "^yarn test( .*)?$",
  "^yarn lint( .*)?$",
  "^bun test( .*)?$",
  "^bun run lint( .*)?$"
];

export const VERIFIER_COMMAND_OBLIGATIONS = [
  "capture_output",
  "attach_as_evidence",
  "redact_secrets"
];

export const DEFAULT_EXTERNAL_WRITE_SIDE_EFFECTS = [
  "network_write_external",
  "send_message_external",
  "git_push",
  "github_pr_create"
];

export const DEFAULT_DANGEROUS_SHELL_COMMAND_PATTERNS = [
  ".*rm -rf.*",
  ".*sudo .*",
  ".*mkfs.*",
  ".*dd if=.*"
];

export const DEFAULT_DEPENDENCY_CHANGE_ACTION_TYPES = [
  "package.install",
  "package.update"
];

export const DEFAULT_DEPENDENCY_CHANGE_PATHS = [
  "package.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "requirements.txt",
  "poetry.lock"
];

export interface CreateRepoMaintenanceMinimumPolicyOptions {
  protectedPaths: string[];
  verifierCommandPatterns?: string[];
  externalWriteSideEffects?: string[];
  dangerousShellCommandPatterns?: string[];
  dependencyChangeActionTypes?: string[];
  dependencyChangePaths?: string[];
  id?: string;
}

export function createProtectedPathDenyPolicy(
  protectedPaths: string[],
  id = "policy_protected_paths_v1"
): PolicyProfile {
  return {
    id,
    version: 1,
    rules: [
      {
        id: "deny_protected_paths",
        when: {
          path: {
            matchesAny: protectedPaths
          }
        },
        decision: "deny",
        risk: "critical"
      }
    ]
  };
}

export function createRepoMaintenanceMinimumPolicy(
  options: CreateRepoMaintenanceMinimumPolicyOptions
): PolicyProfile {
  return {
    id: options.id ?? "policy_repo_maintenance_minimum_v1",
    version: 1,
    defaultDecision: "require_approval",
    defaultRisk: "medium",
    rules: [
      ...createProtectedPathDenyPolicy(options.protectedPaths).rules,
      ...createDangerousShellDenyPolicy(options.dangerousShellCommandPatterns).rules,
      ...createDependencyChangeApprovalPolicy({
        ...(options.dependencyChangeActionTypes === undefined
          ? {}
          : { actionTypes: options.dependencyChangeActionTypes }),
        ...(options.dependencyChangePaths === undefined
          ? {}
          : { paths: options.dependencyChangePaths })
      }).rules,
      ...createVerifierCommandAllowPolicy(options.verifierCommandPatterns).rules,
      ...createExternalWriteApprovalPolicy(options.externalWriteSideEffects).rules
    ]
  };
}

export function createDangerousShellDenyPolicy(
  dangerousCommandPatterns = DEFAULT_DANGEROUS_SHELL_COMMAND_PATTERNS,
  id = "policy_dangerous_shell_deny_v1"
): PolicyProfile {
  return {
    id,
    version: 1,
    rules: [
      {
        id: "deny_destructive_shell",
        when: {
          actionType: "shell.exec",
          command: {
            matchesAny: dangerousCommandPatterns
          }
        },
        decision: "deny",
        risk: "critical"
      }
    ]
  };
}

export interface CreateDependencyChangeApprovalPolicyOptions {
  actionTypes?: string[];
  paths?: string[];
  id?: string;
}

export function createDependencyChangeApprovalPolicy(
  options: CreateDependencyChangeApprovalPolicyOptions = {}
): PolicyProfile {
  return {
    id: options.id ?? "policy_dependency_change_approval_v1",
    version: 1,
    rules: [
      {
        id: "require_approval_dependency_change",
        when: {
          actionType: options.actionTypes ?? DEFAULT_DEPENDENCY_CHANGE_ACTION_TYPES,
          path: {
            matchesAny: options.paths ?? DEFAULT_DEPENDENCY_CHANGE_PATHS
          }
        },
        decision: "require_approval",
        risk: "high"
      }
    ]
  };
}

export function createVerifierCommandAllowPolicy(
  verifierCommandPatterns = DEFAULT_VERIFIER_COMMAND_PATTERNS,
  id = "policy_verifier_commands_v1"
): PolicyProfile {
  return {
    id,
    version: 1,
    defaultDecision: "require_approval",
    defaultRisk: "medium",
    rules: [
      {
        id: "allow_verifier_commands",
        when: {
          actionType: "shell.exec",
          command: {
            matchesAny: verifierCommandPatterns
          }
        },
        decision: "allow",
        risk: "low",
        obligations: VERIFIER_COMMAND_OBLIGATIONS
      }
    ]
  };
}

export function createExternalWriteApprovalPolicy(
  sideEffects = DEFAULT_EXTERNAL_WRITE_SIDE_EFFECTS,
  id = "policy_external_write_approval_v1"
): PolicyProfile {
  return {
    id,
    version: 1,
    rules: [
      {
        id: "require_approval_external_write",
        when: {
          sideEffects: {
            containsAny: sideEffects
          }
        },
        decision: "require_approval",
        risk: "high"
      }
    ]
  };
}

export function evaluatePolicy(options: EvaluatePolicyOptions): PolicyEvaluationResult {
  const matches = options.policy.rules.flatMap((rule) => {
    const match = matchPolicyRule(rule, options.action);

    return match.matched ? [{ rule, match }] : [];
  });
  const selected = strongestPolicyMatch(matches);

  if (selected !== undefined) {
    const { rule, match } = selected;

    return {
      actionId: options.action.actionId,
      decision: rule.decision,
      risk: rule.risk,
      ruleId: rule.id,
      reason: `Matched policy rule ${rule.id}`,
      obligations: rule.obligations ?? [],
      ...(match.path === undefined ? {} : { matchedPath: match.path }),
      ...(match.command === undefined ? {} : { matchedCommand: match.command }),
      ...(match.sideEffect === undefined ? {} : { matchedSideEffect: match.sideEffect })
    };
  }

  const defaultDecision = options.policy.defaultDecision ?? "allow";

  return {
    actionId: options.action.actionId,
    decision: defaultDecision,
    risk: options.policy.defaultRisk ?? defaultRiskForDecision(defaultDecision),
    reason: "No policy rule matched",
    obligations: []
  };
}

function strongestPolicyMatch(
  matches: {
    rule: PolicyRule;
    match: PolicyRuleMatch;
  }[]
): { rule: PolicyRule; match: PolicyRuleMatch } | undefined {
  return matches.reduce<{ rule: PolicyRule; match: PolicyRuleMatch } | undefined>(
    (selected, candidate) => {
      if (selected === undefined) {
        return candidate;
      }

      return decisionRank(candidate.rule.decision) >
        decisionRank(selected.rule.decision)
        ? candidate
        : selected;
    },
    undefined
  );
}

function decisionRank(decision: PolicyDecision): number {
  switch (decision) {
    case "deny":
      return 3;
    case "require_approval":
      return 2;
    case "allow":
      return 1;
  }
}

interface PolicyRuleMatch {
  matched: boolean;
  path?: string;
  command?: string;
  sideEffect?: string;
}

function matchPolicyRule(rule: PolicyRule, action: ActionEnvelope): PolicyRuleMatch {
  if (!matchesActionType(rule.when.actionType, action.actionType)) {
    return { matched: false };
  }

  const pathMatch = matchPathCondition(rule.when.path, action);

  if (pathMatch.required && !pathMatch.matched) {
    return { matched: false };
  }

  const commandMatch = matchCommandCondition(rule.when.command, action);

  if (commandMatch.required && !commandMatch.matched) {
    return { matched: false };
  }

  const sideEffectMatch = matchSideEffectsCondition(rule.when.sideEffects, action);

  if (sideEffectMatch.required && !sideEffectMatch.matched) {
    return { matched: false };
  }

  return {
    matched: true,
    ...(pathMatch.path === undefined ? {} : { path: pathMatch.path }),
    ...(commandMatch.command === undefined ? {} : { command: commandMatch.command }),
    ...(sideEffectMatch.sideEffect === undefined
      ? {}
      : { sideEffect: sideEffectMatch.sideEffect })
  };
}

function matchesActionType(
  expected: string | string[] | undefined,
  actual: string
): boolean {
  if (expected === undefined) {
    return true;
  }

  if (typeof expected === "string") {
    return actual === expected;
  }

  return expected.includes(actual);
}

function matchPathCondition(
  condition: PathMatcherCondition | undefined,
  action: ActionEnvelope
): { required: boolean; matched: boolean; path?: string } {
  if (condition === undefined) {
    return {
      required: false,
      matched: true
    };
  }

  for (const candidatePath of actionPaths(action)) {
    if (
      condition.matchesAny.some((pattern) =>
        matchesPathPattern(candidatePath.normalized, pattern)
      )
    ) {
      return {
        required: true,
        matched: true,
        path: candidatePath.original
      };
    }
  }

  return {
    required: true,
    matched: false
  };
}

function matchCommandCondition(
  condition: RegexMatcherCondition | undefined,
  action: ActionEnvelope
): { required: boolean; matched: boolean; command?: string } {
  if (condition === undefined) {
    return {
      required: false,
      matched: true
    };
  }

  const command = action.context?.command;

  if (command === undefined) {
    return {
      required: true,
      matched: false
    };
  }

  if (condition.matchesAny.some((pattern) => new RegExp(pattern).test(command))) {
    return {
      required: true,
      matched: true,
      command
    };
  }

  return {
    required: true,
    matched: false
  };
}

function matchSideEffectsCondition(
  condition: SideEffectsCondition | undefined,
  action: ActionEnvelope
): { required: boolean; matched: boolean; sideEffect?: string } {
  if (condition === undefined) {
    return {
      required: false,
      matched: true
    };
  }

  const sideEffects = action.context?.sideEffects ?? [];
  const matchedSideEffect = sideEffects.find((sideEffect) =>
    condition.containsAny.includes(sideEffect)
  );

  if (matchedSideEffect !== undefined) {
    return {
      required: true,
      matched: true,
      sideEffect: matchedSideEffect
    };
  }

  return {
    required: true,
    matched: false
  };
}

function actionPaths(
  action: ActionEnvelope
): { original: string; normalized: string }[] {
  const candidates = [
    action.resource?.path,
    ...(action.context?.filesTouched ?? [])
  ].filter((value): value is string => typeof value === "string" && value.length > 0);
  const cwd = action.context?.cwd;

  return candidates.map((candidatePath) => ({
    original: candidatePath,
    normalized: normalizePolicyPath(candidatePath, cwd)
  }));
}

function normalizePolicyPath(path: string, cwd: string | undefined): string {
  const workspacePath =
    cwd !== undefined && isAbsolute(path) ? relative(cwd, path) : path;

  return workspacePath
    .replaceAll("\\", "/")
    .replace(/^\.\/+/, "")
    .replace(/\/+/g, "/")
    .replace(/\/$/, "");
}

function matchesPathPattern(path: string, pattern: string): boolean {
  const pathSegments = pathSegmentsFrom(path);
  const patternSegments = pathSegmentsFrom(pattern);

  return matchesSegments(patternSegments, pathSegments);
}

export function matchesPolicyPathPattern(path: string, pattern: string): boolean {
  return matchesPathPattern(path, pattern);
}

function pathSegmentsFrom(path: string): string[] {
  const normalized = normalizePolicyPath(path, undefined);

  return normalized === "" ? [] : normalized.split("/");
}

function matchesSegments(pattern: string[], path: string[]): boolean {
  if (pattern.length === 0) {
    return path.length === 0;
  }

  const currentPattern = pattern[0];
  const remainingPattern = pattern.slice(1);

  if (currentPattern === undefined) {
    return path.length === 0;
  }

  if (currentPattern === "**") {
    if (remainingPattern.length === 0) {
      return true;
    }

    for (let index = 0; index <= path.length; index += 1) {
      if (matchesSegments(remainingPattern, path.slice(index))) {
        return true;
      }
    }

    return false;
  }

  const currentPath = path[0];
  const remainingPath = path.slice(1);

  if (currentPath === undefined) {
    return false;
  }

  return (
    matchesSegment(currentPattern, currentPath) &&
    matchesSegments(remainingPattern, remainingPath)
  );
}

function matchesSegment(pattern: string, path: string): boolean {
  if (pattern === "*") {
    return true;
  }

  const regex = new RegExp(`^${escapeRegex(pattern).replaceAll("*", "[^/]*")}$`);

  return regex.test(path);
}

function escapeRegex(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

function defaultRiskForDecision(decision: PolicyDecision): PolicyRisk {
  switch (decision) {
    case "allow":
      return "low";
    case "require_approval":
      return "medium";
    case "deny":
      return "critical";
  }
}
