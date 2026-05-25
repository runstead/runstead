import type { RepoInspectionSnapshot } from "./inspection-evidence.js";
import type { LaunchSecurityRiskScan } from "./startup-automation-types.js";

export function repoReadinessBlockers(
  inspection: RepoInspectionSnapshot,
  changedProtected: string[]
): string[] {
  return [
    ...(inspection.commands.test.detected ? [] : ["test command is missing"]),
    ...(inspection.commands.lint.detected ? [] : ["lint command is missing"]),
    ...(inspection.commands.typecheck.detected ? [] : ["typecheck command is missing"]),
    ...(inspection.commands.build.detected ? [] : ["build command is missing"]),
    ...(inspection.ci.detected ? [] : ["CI configuration is missing"]),
    ...(changedProtected.length === 0
      ? []
      : [`protected path changes require review: ${changedProtected.join(", ")}`])
  ];
}

export function repoReadinessWarnings(inspection: RepoInspectionSnapshot): string[] {
  return [
    ...(inspection.git.isGitRepo ? [] : ["workspace is not a Git repository"]),
    ...(inspection.packageManager.detected
      ? []
      : ["package manager could not be detected"])
  ];
}

export function securityBaselineBlockers(
  changedProtected: string[],
  riskScan: LaunchSecurityRiskScan
): string[] {
  return [
    ...(changedProtected.length === 0
      ? []
      : [`protected path changes require review: ${changedProtected.join(", ")}`]),
    ...(riskScan.secretFindings.length === 0
      ? []
      : [
          `potential secret exposure requires review: ${riskScan.secretFindings.join(", ")}`
        ])
  ];
}

export function securityBaselineWarnings(input: {
  envFiles: string[];
  dependencyFiles: string[];
  riskScan: LaunchSecurityRiskScan;
}): string[] {
  return [
    ...(input.envFiles.length === 0
      ? []
      : [`local env files present: ${input.envFiles.join(", ")}`]),
    ...(input.dependencyFiles.length === 0
      ? ["no dependency manifest or lockfile detected"]
      : []),
    ...input.riskScan.licenseFindings,
    ...input.riskScan.dependencyFindings,
    ...input.riskScan.backupRestoreFindings,
    ...input.riskScan.authAndPrivacyFindings,
    ...input.riskScan.prodConfigFindings,
    ...input.riskScan.thirdPartyFindings
  ];
}
