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
}

export interface PathMatcherCondition {
  matchesAny: string[];
}

export interface RegexMatcherCondition {
  matchesAny: string[];
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

export function evaluatePolicy(options: EvaluatePolicyOptions): PolicyEvaluationResult {
  for (const rule of options.policy.rules) {
    const match = matchPolicyRule(rule, options.action);

    if (match.matched) {
      return {
        actionId: options.action.actionId,
        decision: rule.decision,
        risk: rule.risk,
        ruleId: rule.id,
        reason: `Matched policy rule ${rule.id}`,
        obligations: rule.obligations ?? [],
        ...(match.path === undefined ? {} : { matchedPath: match.path }),
        ...(match.command === undefined ? {} : { matchedCommand: match.command })
      };
    }
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

function matchPolicyRule(
  rule: PolicyRule,
  action: ActionEnvelope
): { matched: boolean; path?: string; command?: string } {
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

  return {
    matched: true,
    ...(pathMatch.path === undefined ? {} : { path: pathMatch.path }),
    ...(commandMatch.command === undefined ? {} : { command: commandMatch.command })
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
