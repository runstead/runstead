import type {
  EvidenceReportRow,
  LaunchReadinessReportData
} from "./launch-readiness-data.js";
import {
  currentCommandEvidence,
  currentEvidenceRows,
  staleCommandEvidence
} from "./launch-readiness-evidence.js";

export function riskRegister(
  data: LaunchReadinessReportData,
  blockers: string[]
): string {
  const rows = [
    ...blockers.map((blocker) => ({
      risk: blocker,
      source: riskSource(data, blocker),
      recommendedTask: recommendedTaskForRisk(blocker)
    })),
    ...missingEvidenceRows(data)
  ];

  if (rows.length === 0) {
    return "- no launch risks detected";
  }

  return rows
    .map(
      (row) =>
        `- Risk: ${row.risk}\n  Source: ${row.source}\n  Recommended task: ${row.recommendedTask}`
    )
    .join("\n");
}

export function blockerSource(
  data: LaunchReadinessReportData,
  blocker: string
): string {
  const taskMatch = /^task (?<id>\S+) \((?<type>[^)]+)\) is (?<status>\S+)/.exec(
    blocker
  );

  if (taskMatch?.groups !== undefined) {
    return `task:${taskMatch.groups.id} type=${taskMatch.groups.type} status=${taskMatch.groups.status}`;
  }

  if (blocker.startsWith("approval ")) {
    const approvalId = blocker.split(/\s+/)[1] ?? "unknown";

    return `approval:${approvalId}`;
  }

  if (data.gate.blockers.includes(blocker)) {
    return "phase:launch gate=startup_evidence";
  }

  if (blocker.includes("test command")) return "repo:package_json script=test";
  if (blocker.includes("lint command")) return "repo:package_json script=lint";
  if (blocker.includes("typecheck command")) {
    return "repo:package_json script=typecheck";
  }
  if (blocker.includes("build command")) return "repo:package_json script=build";
  if (blocker.includes("CI configuration")) return "repo:ci_detection";
  if (blocker.includes("protected path")) return "repo:git_status protected_path_scan";
  if (blocker.includes("verifier")) return evidenceSource(data, "command_output");
  if (blocker.includes("measurement")) {
    return evidenceSource(data, "startup_measurement_framework");
  }
  if (blocker.includes("repo readiness")) {
    return evidenceSource(data, "startup_repo_readiness");
  }
  if (blocker.includes("security baseline")) {
    return evidenceSource(data, "startup_security_baseline");
  }
  if (blocker.includes("migration"))
    return evidenceSource(data, "startup_migration_plan");
  if (blocker.includes("rollback"))
    return evidenceSource(data, "startup_rollback_plan");
  if (blocker.includes("observability")) {
    return evidenceSource(data, "startup_observability");
  }
  if (blocker.includes("founder bottleneck")) {
    return evidenceSource(data, "startup_founder_bottleneck");
  }

  return "report:launch_readiness_analysis";
}

function missingEvidenceRows(data: LaunchReadinessReportData): {
  risk: string;
  source: string;
  recommendedTask: string;
}[] {
  const currentEvidence = currentEvidenceRows(data);

  return [
    ...(hasEvidenceType(currentEvidence, "startup_repo_readiness")
      ? []
      : [
          {
            risk: "repo readiness evidence is not recorded",
            source: "evidence ledger",
            recommendedTask: "run startup launch audit"
          }
        ]),
    ...(hasEvidenceType(currentEvidence, "startup_security_baseline")
      ? []
      : [
          {
            risk: "security baseline evidence is not recorded",
            source: "evidence ledger",
            recommendedTask: "run startup launch security-baseline"
          }
        ])
  ];
}

function riskSource(data: LaunchReadinessReportData, risk: string): string {
  if (risk.startsWith("task ")) return blockerSource(data, risk);
  if (risk.includes("test command")) return "package.json scripts";
  if (risk.includes("lint command")) return "package.json scripts";
  if (risk.includes("typecheck command")) return "package.json scripts";
  if (risk.includes("build command")) return "package.json scripts";
  if (risk.includes("CI configuration")) return "repo inspection";
  if (risk.includes("verifier")) return evidenceSource(data, "command_output");
  if (risk.includes("measurement")) {
    return evidenceSource(data, "startup_measurement_framework");
  }
  if (risk.includes("repo readiness")) {
    return evidenceSource(data, "startup_repo_readiness");
  }
  if (risk.includes("security baseline")) {
    return evidenceSource(data, "startup_security_baseline");
  }
  if (risk.includes("migration")) return evidenceSource(data, "startup_migration_plan");
  if (risk.includes("rollback")) return evidenceSource(data, "startup_rollback_plan");
  if (risk.includes("observability")) {
    return evidenceSource(data, "startup_observability");
  }
  if (risk.includes("founder bottleneck")) {
    return evidenceSource(data, "startup_founder_bottleneck");
  }
  if (risk.includes("protected path")) return "git status protected path scan";
  if (risk.includes("approval")) return "approval ledger";

  return "launch readiness analysis";
}

function evidenceSource(data: LaunchReadinessReportData, type: string): string {
  const evidence =
    type === "command_output"
      ? (currentCommandEvidence(data)[0] ?? staleCommandEvidence(data)[0])
      : (currentEvidenceRows(data).find((item) => item.type === type) ??
        data.evidence.find((item) => item.type === type));

  return evidence === undefined ? "missing evidence" : `${evidence.id} ${evidence.uri}`;
}

function recommendedTaskForRisk(risk: string): string {
  if (risk.includes("test command")) return "add or configure a test script";
  if (risk.includes("lint command")) return "add or configure a lint script";
  if (risk.includes("typecheck command")) return "add or configure a typecheck script";
  if (risk.includes("build command")) return "add or configure a build script";
  if (risk.includes("CI configuration")) return "add CI for launch verifier commands";
  if (risk.includes("MVP verifier") || risk.includes("verifier command")) {
    return "run and record MVP verifier evidence";
  }
  if (risk.includes("measurement")) {
    return "run startup measurement generate and attach metric evidence";
  }
  if (risk.includes("repo readiness")) return "run startup launch audit";
  if (risk.includes("security baseline")) {
    return "run startup launch security-baseline";
  }
  if (risk.includes("migration")) return "record startup_migration_plan evidence";
  if (risk.includes("rollback")) return "record startup_rollback_plan evidence";
  if (risk.includes("observability")) return "record startup_observability evidence";
  if (risk.includes("founder bottleneck")) {
    return "run startup launch bottleneck-map";
  }
  if (risk.includes("protected path"))
    return "create review evidence for protected paths";
  if (risk.includes("approval")) return "resolve pending approval before launch";

  return "create a remediation task and attach evidence";
}

function hasEvidenceType(evidence: EvidenceReportRow[], type: string): boolean {
  return evidence.some((item) => item.type === type);
}
