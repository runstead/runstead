export type StartupDependencyApprovalPolicy =
  | "approval-required"
  | "allow-listed"
  | "deny-new";

export interface StartupDependencyApprovalBoundary {
  policy: StartupDependencyApprovalPolicy;
  allowedDependencies: string[];
  approvalRequired: string[];
  workerInstruction: string;
}

export function resolveStartupDependencyApprovalBoundary(input: {
  policy?: string;
  allowedDependencies?: string[];
}): StartupDependencyApprovalBoundary {
  const policy = parseStartupDependencyApprovalPolicy(
    input.policy ?? "approval-required"
  );
  const allowedDependencies = dedupeNonEmpty(input.allowedDependencies ?? []);

  if (policy === "allow-listed" && allowedDependencies.length === 0) {
    throw new Error(
      "--dependency-policy allow-listed requires at least one --allow-dependency value"
    );
  }

  if (policy === "approval-required") {
    return {
      policy,
      allowedDependencies,
      approvalRequired: [
        "dependency additions or upgrades",
        "package manager changes",
        "external writes"
      ],
      workerInstruction:
        "Dependency approval policy: approval-required. Do not install, add, remove, or upgrade dependencies unless the founder explicitly grants approval in this run. If a dependency would improve the MVP, return needs_approval=true with the package name, dependency class, and reason."
    };
  }

  if (policy === "allow-listed") {
    return {
      policy,
      allowedDependencies,
      approvalRequired: [
        "dependencies outside allowed list",
        "package manager changes outside allowed list",
        "external writes"
      ],
      workerInstruction: [
        "Dependency approval policy: allow-listed.",
        `Allowed dependency additions: ${allowedDependencies.join(", ")}.`,
        "Do not install, add, remove, or upgrade any dependency outside this list unless approval is granted. If another dependency is needed, return needs_approval=true with the package name, dependency class, and reason."
      ].join(" ")
    };
  }

  return {
    policy,
    allowedDependencies: [],
    approvalRequired: ["all dependency additions or upgrades", "external writes"],
    workerInstruction:
      "Dependency approval policy: deny-new. Do not install, add, remove, or upgrade dependencies in this run. If the MVP cannot be completed without a dependency change, return needs_approval=true with the package name, dependency class, and reason."
  };
}

export function formatStartupDependencyApprovalBoundary(
  boundary: StartupDependencyApprovalBoundary
): string {
  return [
    boundary.policy,
    `allowed=${boundary.allowedDependencies.length === 0 ? "none" : boundary.allowedDependencies.join(",")}`,
    `approval_required=${boundary.approvalRequired.join(", ")}`
  ].join("; ");
}

function parseStartupDependencyApprovalPolicy(
  value: string
): StartupDependencyApprovalPolicy {
  if (
    value === "approval-required" ||
    value === "allow-listed" ||
    value === "deny-new"
  ) {
    return value;
  }

  throw new Error(
    `Unsupported dependency policy ${value}. Expected approval-required, allow-listed, or deny-new.`
  );
}

function dedupeNonEmpty(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
