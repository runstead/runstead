import type { Goal, Task } from "@runstead/core";
import { openRunsteadDatabase } from "@runstead/state-sqlite";

import type { RunOnceResult } from "./run-types.js";

export interface WorkPackEvidenceContract {
  outputs: string[];
  completionCriteria: string[];
}

export interface WorkPackEvidenceRequirementVerdict {
  id: string;
  satisfied: boolean;
  evidenceIds: string[];
  reason: string;
}

export interface WorkPackEvidenceContractVerdict {
  status: "complete" | "incomplete" | "not_declared";
  outputs: WorkPackEvidenceRequirementVerdict[];
  completionCriteria: WorkPackEvidenceRequirementVerdict[];
  evidence: WorkPackEvidenceRow[];
}

export interface WorkPackEvidenceRow {
  id: string;
  type: string;
  subjectType: string;
  subjectId: string;
  summary?: string;
  createdAt: string;
}

export function evaluateWorkPackEvidenceContract(input: {
  stateDb: string;
  contract?: WorkPackEvidenceContract;
  goal: Goal;
  tasks: Task[];
  taskResults: RunOnceResult[];
}): WorkPackEvidenceContractVerdict {
  const evidence = listWorkflowEvidence({
    stateDb: input.stateDb,
    goal: input.goal,
    tasks: input.tasks
  });

  if (input.contract === undefined) {
    return {
      status: "not_declared",
      outputs: [],
      completionCriteria: [],
      evidence
    };
  }

  const outputs = input.contract.outputs.map((id) =>
    evaluateEvidenceRequirement({ id, evidence, kind: "output" })
  );
  const completionCriteria = input.contract.completionCriteria.map((id) =>
    evaluateEvidenceRequirement({
      id,
      evidence,
      kind: "completion_criterion",
      taskResults: input.taskResults,
      stateDb: input.stateDb,
      goal: input.goal,
      tasks: input.tasks
    })
  );
  const complete = [...outputs, ...completionCriteria].every(
    (item) => item.satisfied
  );

  return {
    status: complete ? "complete" : "incomplete",
    outputs,
    completionCriteria,
    evidence
  };
}

function listWorkflowEvidence(input: {
  stateDb: string;
  goal: Goal;
  tasks: Task[];
}): WorkPackEvidenceRow[] {
  const database = openRunsteadDatabase(input.stateDb);
  const taskIds = new Set(input.tasks.map((task) => task.id));

  try {
    const rows = database
      .prepare(
        `
          SELECT
            id,
            type,
            subject_type,
            subject_id,
            summary,
            created_at
          FROM evidence
          WHERE created_at >= ?
          ORDER BY created_at, id
        `
      )
      .all(input.goal.createdAt) as unknown as EvidenceSqlRow[];

    return rows
      .map(evidenceRowFromSql)
      .filter(
        (row) =>
          row.subjectId === input.goal.id ||
          taskIds.has(row.subjectId) ||
          row.subjectType === "repository" ||
          row.createdAt >= input.goal.createdAt
      );
  } finally {
    database.close();
  }
}

function evaluateEvidenceRequirement(input: {
  id: string;
  evidence: WorkPackEvidenceRow[];
  kind: "output" | "completion_criterion";
  taskResults?: RunOnceResult[];
  stateDb?: string;
  goal?: Goal;
  tasks?: Task[];
}): WorkPackEvidenceRequirementVerdict {
  const evidenceTypes = evidenceTypesForContractKey(input.id);
  const matches = input.evidence.filter((row) => evidenceTypes.includes(row.type));

  if (matches.length > 0) {
    return {
      id: input.id,
      satisfied: true,
      evidenceIds: matches.map((row) => row.id),
      reason: `covered by evidence type ${matches[0]?.type ?? "unknown"}`
    };
  }

  const special = specialCompletionCriterionVerdict(input);

  if (special !== undefined) {
    return special;
  }

  return {
    id: input.id,
    satisfied: false,
    evidenceIds: [],
    reason: `missing ${input.kind} evidence; expected one of ${evidenceTypes.join(", ")}`
  };
}

function specialCompletionCriterionVerdict(input: {
  id: string;
  evidence: WorkPackEvidenceRow[];
  kind: "output" | "completion_criterion";
  taskResults?: RunOnceResult[];
  stateDb?: string;
  goal?: Goal;
  tasks?: Task[];
}): WorkPackEvidenceRequirementVerdict | undefined {
  if (input.kind !== "completion_criterion") {
    return undefined;
  }

  if (input.id === "audit_event_recorded") {
    const eventCount =
      input.stateDb === undefined || input.goal === undefined || input.tasks === undefined
        ? 0
        : countWorkflowAuditEvents({
            stateDb: input.stateDb,
            goal: input.goal,
            tasks: input.tasks
          });

    return {
      id: input.id,
      satisfied: eventCount > 0,
      evidenceIds: [],
      reason:
        eventCount > 0
          ? `${eventCount} workflow audit event(s) recorded`
          : "missing workflow audit events"
    };
  }

  if (input.id === "verifiers_pass_or_blockers_recorded") {
    const commandEvidence = input.evidence.filter(
      (row) => row.type === "command_output"
    );
    const hasBlocker =
      input.taskResults?.some(
        (result) =>
          result.ranTask &&
          (result.task.status === "blocked" ||
            result.task.status === "waiting_approval")
      ) ?? false;

    return {
      id: input.id,
      satisfied: commandEvidence.length > 0 || hasBlocker,
      evidenceIds: commandEvidence.map((row) => row.id),
      reason:
        commandEvidence.length > 0
          ? "command verifier evidence recorded"
          : hasBlocker
            ? "workflow blocker recorded on a task"
            : "missing verifier evidence or recorded blocker"
    };
  }

  return undefined;
}

function countWorkflowAuditEvents(input: {
  stateDb: string;
  goal: Goal;
  tasks: Task[];
}): number {
  const database = openRunsteadDatabase(input.stateDb);
  const aggregateIds = [input.goal.id, ...input.tasks.map((task) => task.id)];
  const placeholders = aggregateIds.map(() => "?").join(", ");

  try {
    const row = database
      .prepare(
        `
          SELECT COUNT(*) AS count
          FROM events
          WHERE aggregate_id IN (${placeholders})
        `
      )
      .get(...aggregateIds) as { count: number };

    return row.count;
  } finally {
    database.close();
  }
}

function evidenceTypesForContractKey(key: string): string[] {
  const normalized = normalizeContractKey(key);
  const aliases = CONTRACT_EVIDENCE_ALIASES[normalized] ?? [];

  return [normalized, ...aliases].filter(
    (value, index, values) => values.indexOf(value) === index
  );
}

function normalizeContractKey(key: string): string {
  return key.trim().toLowerCase().replaceAll(/[^a-z0-9]+/g, "_");
}

function evidenceRowFromSql(row: EvidenceSqlRow): WorkPackEvidenceRow {
  return {
    id: row.id,
    type: row.type,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    ...(row.summary === null ? {} : { summary: row.summary }),
    createdAt: row.created_at
  };
}

interface EvidenceSqlRow {
  id: string;
  type: string;
  subject_type: string;
  subject_id: string;
  summary: string | null;
  created_at: string;
}

const CONTRACT_EVIDENCE_ALIASES: Record<string, string[]> = {
  repo_readiness: ["repo_inspection"],
  startup_repo_readiness: ["repo_inspection", "startup_repo_readiness"],
  verifier_report: ["command_output"],
  git_diff_scope: ["command_output"],
  ci_repair_summary: ["github_workflow_run"],
  startup_hypothesis: [
    "startup_hypothesis",
    "startup_problem_hypothesis",
    "startup_user_hypothesis",
    "startup_solution_hypothesis"
  ],
  mvp_build_gate: ["startup_decision"],
  founder_bottleneck_map: ["startup_founder_bottleneck"],
  workflow_automation_registry: ["startup_workflow_registry"],
  ops_sop: ["startup_ops_sop"],
  support_triage: ["startup_support_triage"],
  gtm_artifact_review: ["startup_gtm_artifact"],
  source_inventory: ["source_inventory"],
  source_reliability_assessment: ["source_reliability_assessment"],
  citation_ledger: ["citation_ledger"],
  contradiction_review: ["contradiction_review"],
  digest_draft: ["digest_draft"],
  publish_approval: ["publish_approval"],
  archive_record: ["archive_record"],
  agent_context_current: ["startup_agent_context"],
  measurement_framework_defined: ["startup_measurement_framework"],
  repo_readiness_inspected: ["repo_inspection", "startup_repo_readiness"],
  verifier_evidence_fresh: ["command_output"],
  launch_readiness_report_ready: ["launch_readiness_report"],
  problem_hypothesis_recorded: [
    "startup_hypothesis",
    "startup_problem_hypothesis"
  ],
  customer_evidence_attached: ["startup_customer_interview"],
  disconfirming_review_complete: ["startup_disconfirming"],
  build_gate_decision_recorded: ["startup_decision"],
  bottlenecks_mapped: ["startup_founder_bottleneck"],
  automations_registered: ["startup_workflow_registry"],
  support_and_gtm_verified: ["startup_support_triage", "startup_gtm_artifact"],
  scale_gate_passed: ["startup_decision"],
  sources_fresh: ["source_inventory"],
  claims_cited: ["citation_ledger"],
  contradictions_reviewed: ["contradiction_review"],
  publish_gate_recorded: ["publish_approval"],
  archive_record_created: ["archive_record"]
};
