import type { StartupGateStage } from "./startup-evidence.js";

export interface StartupRemediationGuidance {
  scope: string;
  verifier: string;
  verifiers: string[];
  expectedEvidence: string[];
  acceptanceCriteria: string[];
  order: number;
}

export function remediationGuidance(blocker: string): StartupRemediationGuidance {
  const normalized = blocker.toLowerCase();

  if (normalized.includes("measurement") || normalized.includes("metric")) {
    return {
      scope:
        "Define or attach launch metric evidence with source, threshold, current value, and snapshot date.",
      verifier: "runstead startup gate check --stage launch",
      verifiers: ["evidence:startup_metric", "command:startup_gate_check"],
      expectedEvidence: ["startup_metric", "startup_measurement_framework"],
      acceptanceCriteria: [
        "measurement framework or metric snapshot evidence is recorded",
        "metric source, threshold, current value, and freshness are reviewable"
      ],
      order: 20
    };
  }

  if (normalized.includes("verifier") || normalized.includes("command_output")) {
    return {
      scope:
        "Run the MVP verifier task after the latest product change and attach passing command_output evidence.",
      verifier: "runstead verifier run <task-id>",
      verifiers: ["evidence:command_output", "command:startup_gate_check"],
      expectedEvidence: ["command_output"],
      acceptanceCriteria: [
        "verifier command evidence exists",
        "startup gate no longer reports missing passing verifier evidence"
      ],
      order: 30
    };
  }

  if (normalized.includes("security")) {
    return {
      scope:
        "Produce or refresh the launch security baseline and remediate any high-risk findings.",
      verifier: "runstead startup launch security-baseline",
      verifiers: ["evidence:startup_security_baseline", "command:startup_gate_check"],
      expectedEvidence: ["startup_security_baseline"],
      acceptanceCriteria: [
        "security baseline evidence is recorded",
        "critical launch security findings have owners or fixes"
      ],
      order: 15
    };
  }

  if (normalized.includes("repo") || normalized.includes("ci")) {
    return {
      scope:
        "Fix repository readiness gaps such as missing scripts, CI, or launch-critical hygiene.",
      verifier: "runstead startup launch audit",
      verifiers: ["evidence:startup_repo_readiness", "command:startup_gate_check"],
      expectedEvidence: ["startup_repo_readiness"],
      acceptanceCriteria: [
        "repo readiness evidence is recorded",
        "required local verifier scripts or CI signals are present"
      ],
      order: 10
    };
  }

  if (normalized.includes("migration")) {
    return {
      scope:
        "Record migration owner, remediation task, and acceptance criteria for this launch.",
      verifier: "runstead startup gate check --stage launch",
      verifiers: ["evidence:startup_migration_plan", "command:startup_gate_check"],
      expectedEvidence: ["startup_migration_plan"],
      acceptanceCriteria: [
        "migration evidence has owner, task, and acceptance criteria"
      ],
      order: 40
    };
  }

  if (normalized.includes("rollback")) {
    return {
      scope:
        "Record rollback owner, remediation task, and acceptance criteria for this launch.",
      verifier: "runstead startup gate check --stage launch",
      verifiers: ["evidence:startup_rollback_plan", "command:startup_gate_check"],
      expectedEvidence: ["startup_rollback_plan"],
      acceptanceCriteria: [
        "rollback evidence has owner, task, and acceptance criteria"
      ],
      order: 45
    };
  }

  if (normalized.includes("observability")) {
    return {
      scope:
        "Record launch observability owner, remediation task, alert surface, and acceptance criteria.",
      verifier: "runstead startup gate check --stage launch",
      verifiers: ["evidence:startup_observability", "command:startup_gate_check"],
      expectedEvidence: ["startup_observability"],
      acceptanceCriteria: [
        "observability evidence has owner, alert surface, and acceptance criteria"
      ],
      order: 50
    };
  }

  if (normalized.includes("founder") || normalized.includes("bottleneck")) {
    return {
      scope:
        "Map founder-only launch knowledge to an owner, system of record, and handoff acceptance check.",
      verifier: "runstead startup launch bottleneck-map",
      verifiers: ["evidence:startup_founder_bottleneck", "command:startup_gate_check"],
      expectedEvidence: ["startup_founder_bottleneck"],
      acceptanceCriteria: [
        "founder bottleneck evidence assigns an owner and handoff status"
      ],
      order: 60
    };
  }

  if (normalized.includes("accepted debt")) {
    return {
      scope: "Attach an explicit decision record before accepting launch debt.",
      verifier: "runstead startup gate check --stage launch",
      verifiers: ["evidence:startup_decision", "command:startup_gate_check"],
      expectedEvidence: ["startup_decision", "startup_acceptable_debt"],
      acceptanceCriteria: ["accepted debt is linked to an explicit decision record"],
      order: 70
    };
  }

  return {
    scope: `Resolve launch readiness blocker: ${blocker}`,
    verifier: "runstead startup gate check --stage launch",
    verifiers: ["command:startup_gate_check"],
    expectedEvidence: ["startup_evidence"],
    acceptanceCriteria: ["startup gate no longer reports this blocker"],
    order: 90
  };
}

export function remediationNextCommands(stage: StartupGateStage): string[] {
  return stage === "launch"
    ? ["runstead startup gate check --stage launch", "runstead startup launch report"]
    : [`runstead startup gate check --stage ${stage}`];
}

export function jsonStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export function uniqueBlockers(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const key = blockerClusterKey(value);

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(value);
  }

  return result;
}

export function prioritizedBlockers(values: string[]): string[] {
  return [...values].sort(
    (a, b) => remediationGuidance(a).order - remediationGuidance(b).order
  );
}

function blockerClusterKey(value: string): string {
  const lowered = value.toLowerCase();

  if (lowered.includes("metric") || lowered.includes("measurement")) {
    return "measurement";
  }

  if (lowered.includes("verifier") || lowered.includes("command")) {
    return "verifier";
  }

  if (lowered.includes("security") || lowered.includes("dependency")) {
    return "security";
  }

  if (lowered.includes("repo") || lowered.includes("ci")) {
    return "repo";
  }

  return lowered.replace(/\s+/g, " ").trim();
}
