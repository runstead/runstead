import { listItems, listItemsOrNone } from "./startup-format-helpers.js";
import type { LaunchSecurityRiskScan } from "./startup-automation-types.js";

export function formatSecurityBaseline(input: {
  generatedAt: string;
  changedProtected: string[];
  envFiles: string[];
  dependencyFiles: string[];
  riskScan: LaunchSecurityRiskScan;
  blockers: string[];
  warnings: string[];
}): string {
  return [
    "# Startup Security Baseline",
    "",
    `Generated: ${input.generatedAt}`,
    "",
    "## Protected Path Changes",
    "",
    listItemsOrNone(input.changedProtected),
    "",
    "## Local Secret And Env Files",
    "",
    listItemsOrNone(input.envFiles),
    "",
    "## Dependency Manifests",
    "",
    listItemsOrNone(input.dependencyFiles),
    "",
    "## Launch Risk Scan",
    "",
    "### Secret Findings",
    listItemsOrNone(input.riskScan.secretFindings),
    "",
    "### License Findings",
    listItemsOrNone(input.riskScan.licenseFindings),
    "",
    "### Dependency Findings",
    listItemsOrNone(input.riskScan.dependencyFindings),
    "",
    "### Backup And Restore Findings",
    listItemsOrNone(input.riskScan.backupRestoreFindings),
    "",
    "### Auth And Privacy Findings",
    listItemsOrNone(input.riskScan.authAndPrivacyFindings),
    "",
    "### Production Config Findings",
    listItemsOrNone(input.riskScan.prodConfigFindings),
    "",
    "### Third-party Integration Findings",
    listItemsOrNone(input.riskScan.thirdPartyFindings),
    "",
    "## Launch Security Blockers",
    "",
    listItemsOrNone(input.blockers),
    "",
    "## Warnings",
    "",
    listItemsOrNone(input.warnings),
    "",
    "## Release Evidence Contract",
    "",
    listItems([
      "No changed protected path may launch without explicit review evidence.",
      "Secrets must stay out of committed evidence and reports.",
      "Dependency changes require verifier evidence and rollback notes.",
      "Run startup gate check --stage launch after recording migration, rollback, and observability evidence."
    ]),
    ""
  ].join("\n");
}
