export type ApprovalCommandStatus = "pending" | "approved" | "denied" | "expired";

export function parseApprovalStatus(
  value: string | undefined
): ApprovalCommandStatus | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (
    value === "pending" ||
    value === "approved" ||
    value === "denied" ||
    value === "expired"
  ) {
    return value;
  }

  throw new Error("--status must be pending, approved, denied, or expired");
}

export function approvalPolicyFingerprint(result: unknown): string {
  if (!isRecord(result)) {
    return "unknown";
  }

  return typeof result.policyFingerprint === "string"
    ? result.policyFingerprint
    : "unknown";
}

export function approvalActionField(action: unknown, field: string): string {
  if (!isRecord(action)) {
    return "unknown";
  }

  const value = action[field];
  return typeof value === "string" ? value : "unknown";
}

export function approvalResourceSummary(action: unknown): string {
  if (!isRecord(action) || !isRecord(action.resource)) {
    return "unknown";
  }

  const type =
    typeof action.resource.type === "string" ? action.resource.type : "unknown";
  const identifier =
    typeof action.resource.id === "string"
      ? action.resource.id
      : typeof action.resource.path === "string"
        ? action.resource.path
        : undefined;

  return identifier === undefined ? type : `${type}:${identifier}`;
}

export function approvalGrantReuseSummary(metadata: {
  canonicalSignature?: string;
  riskClass?: string;
  filesTouched: string[];
  diffHash?: string;
}): string {
  if (metadata.canonicalSignature === undefined) {
    return "same action id only";
  }

  const files =
    metadata.filesTouched.length === 0
      ? "unknown files"
      : metadata.filesTouched.join(", ");
  const risk = metadata.riskClass ?? "unknown risk";
  const diff = metadata.diffHash ?? "unknown diff";

  return `equivalent ${risk} actions touching ${files} with diff ${diff} can reuse canonical signature ${metadata.canonicalSignature}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
