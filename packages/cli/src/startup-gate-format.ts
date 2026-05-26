import type { StartupGateCheckResult } from "./startup-evidence.js";

export function formatStartupGateCheckResult(result: StartupGateCheckResult): string {
  return [
    `Startup gate: ${result.stage}`,
    `Domain: ${result.domain}`,
    `Status: ${result.passed ? "passed" : "blocked"}`,
    `Added blockers: ${result.diff.addedBlockers.length}`,
    `Resolved blockers: ${result.diff.resolvedBlockers.length}`,
    "",
    "Blockers:",
    listOrNone(result.blockers, (blocker) => `- ${blocker}`),
    "",
    "Findings:",
    listOrNone(
      result.findings,
      (finding) =>
        `- [${finding.severity}] ${finding.message}${finding.waived ? " (waived)" : ""}`
    ),
    ...(result.stage === "mvp" && !result.passed
      ? [
          "",
          "MVP build gate explanation:",
          "MVP build cannot start until each blocker has evidence, hypothesis status, and disconfirming-signal resolution."
        ]
      : []),
    "",
    "Warnings:",
    listOrNone(result.warnings, (warning) => `- ${warning}`)
  ].join("\n");
}

function listOrNone<T>(items: T[], formatter: (item: T) => string): string {
  if (items.length === 0) {
    return "- none";
  }

  return items.map(formatter).join("\n");
}
