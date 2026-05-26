import type { GitHubWorkflowRunLog } from "./github-actions.js";

export function redactGitHubWorkflowRunLog(
  log: GitHubWorkflowRunLog
): GitHubWorkflowRunLog {
  const redactedLog = redactSecretLikeValues(log.log);

  return {
    ...log,
    log: redactedLog,
    byteLength: Buffer.byteLength(redactedLog)
  };
}

function redactSecretLikeValues(value: string): string {
  return value
    .replace(
      /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
      "[REDACTED_PRIVATE_KEY]"
    )
    .replace(/github_pat_[A-Za-z0-9_]+/g, "[REDACTED_GITHUB_TOKEN]")
    .replace(/gh[pousr]_[A-Za-z0-9_]+/g, "[REDACTED_GITHUB_TOKEN]")
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, "[REDACTED_AWS_ACCESS_KEY]")
    .replace(
      /\b(Authorization:\s*(?:Bearer|Basic)\s+)[A-Za-z0-9._~+/-]+=*/gi,
      "$1[REDACTED]"
    )
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, "$1[REDACTED]")
    .replace(
      /\b([A-Z0-9_ -]*(?:TOKEN|SECRET|PASSWORD|PASS|KEY|API[_ -]?KEY)[A-Z0-9_ -]*)(\s*[:=]\s*)([^\s]+)/gi,
      "$1$2[REDACTED]"
    );
}
