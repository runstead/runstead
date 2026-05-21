import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Evidence, Task } from "@runstead/core";
import { appendEventAndProject, openRunsteadDatabase } from "@runstead/state-sqlite";
import { describe, expect, it } from "vitest";

import { installDomainPack } from "./domain-pack-install.js";
import { createGoal } from "./goals.js";
import { initRunstead } from "./init.js";
import {
  addStartupEvidence,
  addStartupHypothesis,
  checkStartupGate,
  formatStartupGateCheckResult,
  recordStartupGateDecision,
  type StartupEvidenceArtifact
} from "./startup-evidence.js";

describe("startup evidence ledger", () => {
  it("records founder evidence artifacts and blocks launch without measurement", async () => {
    const workspace = join(tmpdir(), `runstead-startup-evidence-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      const initialized = await initRunstead({ cwd: workspace });
      await installDomainPack({
        cwd: workspace,
        ref: "ai-native-startup",
        now: new Date("2026-05-14T02:00:00.000Z")
      });
      const created = await createGoal({
        cwd: workspace,
        domain: "ai-native-startup",
        template: "build-mvp",
        now: new Date("2026-05-14T03:00:00.000Z")
      });
      const customerEvidence = await addStartupEvidence({
        cwd: workspace,
        type: "customer_interview",
        summary: "Founder interviewed three target users",
        sourceRefs: ["interview-notes:2026-05-14"],
        sources: [
          {
            kind: "support_ticket",
            uri: "https://support.example/tickets/123",
            capturedAt: "2026-05-14T03:59:00.000Z",
            freshnessDays: 14,
            hash: "sha256:ticket-123"
          }
        ],
        gate: "mvp",
        blocker: "customer validation evidence is missing",
        owner: "founder",
        remediationTask: "Attach customer interview source",
        acceptanceCriteria: "Interview source is linked and fresh",
        goalId: created.goal.id,
        now: new Date("2026-05-14T04:00:00.000Z")
      });
      const blockedGate = await checkStartupGate({
        cwd: workspace,
        stage: "launch",
        domain: "ai-native-startup",
        now: new Date("2026-05-14T04:10:00.000Z")
      });

      expect(customerEvidence.evidence).toMatchObject({
        type: "startup_customer_interview",
        subjectType: "goal",
        subjectId: created.goal.id,
        summary: "Founder interviewed three target users"
      });
      const customerArtifact = JSON.parse(
        await readFile(customerEvidence.artifactPath, "utf8")
      ) as StartupEvidenceArtifact;

      expect(customerArtifact).toMatchObject({
        evidenceType: "customer_interview",
        sourceRefs: ["interview-notes:2026-05-14"],
        sources: [
          {
            kind: "support_ticket",
            uri: "https://support.example/tickets/123",
            capturedAt: "2026-05-14T03:59:00.000Z",
            freshnessDays: 14,
            hash: "sha256:ticket-123"
          },
          {
            kind: "manual",
            uri: "interview-notes:2026-05-14",
            capturedAt: "2026-05-14T04:00:00.000Z"
          }
        ],
        provenance: {
          recordedBy: "runstead",
          captureMode: "source_attached",
          sourceCount: 2
        },
        associations: {
          goalId: created.goal.id,
          gate: "mvp",
          blocker: "customer validation evidence is missing"
        },
        remediation: {
          owner: "founder",
          task: "Attach customer interview source",
          acceptanceCriteria: "Interview source is linked and fresh"
        }
      });
      expect(blockedGate.passed).toBe(false);
      expect(blockedGate.blockers).toContain("measurement framework is missing");
      expect(formatStartupGateCheckResult(blockedGate)).toContain("Status: blocked");

      await addStartupEvidence({
        cwd: workspace,
        type: "measurement_framework",
        summary: "Activation and retention metrics are defined",
        sourceRefs: ["metrics.md"],
        goalId: created.goal.id,
        now: new Date("2026-05-14T04:20:00.000Z")
      });
      await addStartupEvidence({
        cwd: workspace,
        type: "metric",
        summary: "Activation metric snapshot is above launch threshold",
        sourceRefs: ["analytics:activation:2026-05-14"],
        goalId: created.goal.id,
        content: JSON.stringify({
          metric: "activation",
          source: "manual snapshot",
          threshold: 0.4,
          current: 0.52
        }),
        now: new Date("2026-05-14T04:22:00.000Z")
      });
      for (const [type, summary] of [
        ["repo_readiness", "Repository readiness audit is clean"],
        ["security_baseline", "Security baseline is clean"],
        ["migration_plan", "No migrations required for this release"],
        ["rollback_plan", "Rollback uses the previous deployment artifact"],
        ["observability", "Launch dashboard and alert owner are defined"],
        ["founder_bottleneck", "Founder-only launch knowledge has an owner"]
      ] as const) {
        await addStartupEvidence({
          cwd: workspace,
          type,
          summary,
          goalId: created.goal.id,
          content: launchRemediationContent(type),
          now: new Date("2026-05-14T04:25:00.000Z")
        });
      }

      const verifierTask = created.generatedTasks.find(
        (task) => task.type === "run_mvp_verifiers"
      );

      if (verifierTask === undefined) {
        throw new Error("Expected build-mvp goal to create run_mvp_verifiers");
      }

      const gateDatabase = openRunsteadDatabase(initialized.stateDb);

      try {
        projectTask(gateDatabase, {
          ...verifierTask,
          status: "completed",
          updatedAt: "2026-05-14T04:28:00.000Z"
        });
      } finally {
        gateDatabase.close();
      }

      const missingVerifierEvidenceGate = await checkStartupGate({
        cwd: workspace,
        stage: "launch",
        domain: "ai-native-startup",
        now: new Date("2026-05-14T04:30:00.000Z")
      });

      expect(missingVerifierEvidenceGate.passed).toBe(false);
      expect(missingVerifierEvidenceGate.blockers).toEqual([
        "passing verifier command evidence is missing"
      ]);
      expect(missingVerifierEvidenceGate.warnings).toEqual([]);

      await writeVerifierArtifact({
        root: initialized.root,
        fileName: "verifier-failed.json",
        exitCode: 1,
        createdAt: "2026-05-14T04:31:00.000Z"
      });
      const failedCommandEvidenceDatabase = openRunsteadDatabase(initialized.stateDb);

      try {
        projectEvidence(failedCommandEvidenceDatabase, {
          id: "ev_startup_launch_command_failed_001",
          type: "command_output",
          subjectType: "task",
          subjectId: verifierTask.id,
          uri: `file://${join(initialized.root, "evidence", "verifier-failed.json")}`,
          summary: "MVP verifier commands failed",
          createdAt: "2026-05-14T04:31:00.000Z"
        });
      } finally {
        failedCommandEvidenceDatabase.close();
      }

      const failedVerifierEvidenceGate = await checkStartupGate({
        cwd: workspace,
        stage: "launch",
        domain: "ai-native-startup",
        now: new Date("2026-05-14T04:31:30.000Z")
      });

      expect(failedVerifierEvidenceGate.passed).toBe(false);
      expect(failedVerifierEvidenceGate.blockers).toEqual([
        "passing verifier command evidence is missing"
      ]);

      await writeVerifierArtifact({
        root: initialized.root,
        fileName: "verifier-passed.json",
        exitCode: 0,
        createdAt: "2026-05-14T04:32:00.000Z"
      });

      const commandEvidenceDatabase = openRunsteadDatabase(initialized.stateDb);
      const wrappedWorkerTask: Task = {
        id: "task_repo_wrapped_worker_001",
        goalId: created.goal.id,
        domain: "repo-maintenance",
        type: "local_agent_task",
        status: "completed",
        priority: "medium",
        attempt: 1,
        maxAttempts: 1,
        input: {
          worker: "codex_cli",
          commands: [
            {
              name: "test",
              command: "npm test"
            }
          ]
        },
        verifiers: ["command:test"],
        createdAt: "2026-05-14T04:29:00.000Z",
        updatedAt: "2026-05-14T04:32:00.000Z"
      };

      try {
        projectTask(commandEvidenceDatabase, wrappedWorkerTask);
        projectEvidence(commandEvidenceDatabase, {
          id: "ev_startup_launch_command_001",
          type: "command_output",
          subjectType: "task",
          subjectId: wrappedWorkerTask.id,
          uri: `file://${join(initialized.root, "evidence", "verifier-passed.json")}`,
          summary: "Wrapped Codex CLI verifier commands passed",
          createdAt: "2026-05-14T04:31:00.000Z"
        });
      } finally {
        commandEvidenceDatabase.close();
      }

      const passedGate = await checkStartupGate({
        cwd: workspace,
        stage: "launch",
        domain: "ai-native-startup",
        now: new Date("2026-05-14T04:32:00.000Z")
      });

      expect(passedGate.passed).toBe(true);
      expect(passedGate.blockers).toEqual([]);
      expect(passedGate.warnings).toEqual([]);

      await addStartupEvidence({
        cwd: workspace,
        type: "acceptable_debt",
        summary: "Ship without automated retention cohort export",
        sourceRefs: ["launch-review:2026-05-14"],
        goalId: created.goal.id,
        now: new Date("2026-05-14T04:33:00.000Z")
      });
      const undecidedDebtGate = await checkStartupGate({
        cwd: workspace,
        stage: "launch",
        domain: "ai-native-startup",
        now: new Date("2026-05-14T04:34:00.000Z")
      });

      expect(undecidedDebtGate.passed).toBe(false);
      expect(undecidedDebtGate.blockers).toContain(
        "accepted debt requires an explicit decision association"
      );

      const database = openRunsteadDatabase(initialized.stateDb);

      try {
        const evidenceRows = database
          .prepare(
            `
            SELECT type, subject_type, subject_id
            FROM evidence
            WHERE type LIKE 'startup_%'
            ORDER BY type ASC
          `
          )
          .all() as { type: string; subject_type: string; subject_id: string }[];
        const gateEvents = database
          .prepare(
            `
            SELECT type, aggregate_type, aggregate_id
            FROM events
            WHERE type = 'startup_gate.checked'
            ORDER BY created_at ASC
          `
          )
          .all() as { type: string; aggregate_type: string; aggregate_id: string }[];

        expect(evidenceRows.map((row) => row.type)).toEqual([
          "startup_acceptable_debt",
          "startup_customer_interview",
          "startup_founder_bottleneck",
          "startup_measurement_framework",
          "startup_metric",
          "startup_migration_plan",
          "startup_observability",
          "startup_repo_readiness",
          "startup_rollback_plan",
          "startup_security_baseline"
        ]);
        expect(gateEvents).toEqual([
          {
            type: "startup_gate.checked",
            aggregate_type: "startup_gate",
            aggregate_id: "ai-native-startup_launch"
          },
          {
            type: "startup_gate.checked",
            aggregate_type: "startup_gate",
            aggregate_id: "ai-native-startup_launch"
          },
          {
            type: "startup_gate.checked",
            aggregate_type: "startup_gate",
            aggregate_id: "ai-native-startup_launch"
          },
          {
            type: "startup_gate.checked",
            aggregate_type: "startup_gate",
            aggregate_id: "ai-native-startup_launch"
          },
          {
            type: "startup_gate.checked",
            aggregate_type: "startup_gate",
            aggregate_id: "ai-native-startup_launch"
          }
        ]);
      } finally {
        database.close();
      }
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("accepts later high-quality launch evidence and remediation metadata", async () => {
    const workspace = join(
      tmpdir(),
      `runstead-startup-evidence-quality-${process.pid}`
    );

    try {
      await rm(workspace, { force: true, recursive: true });
      const initialized = await initRunstead({ cwd: workspace });
      await installDomainPack({
        cwd: workspace,
        ref: "ai-native-startup",
        now: new Date("2026-05-14T05:00:00.000Z")
      });
      const created = await createGoal({
        cwd: workspace,
        domain: "ai-native-startup",
        template: "build-mvp",
        now: new Date("2026-05-14T05:01:00.000Z")
      });

      for (const [type, summary, content] of [
        ["measurement_framework", "Measurement framework exists", undefined],
        [
          "metric",
          "Activation is above launch threshold",
          JSON.stringify({ source: "manual", threshold: 1, current: 1 })
        ],
        ["repo_readiness", "Repo readiness is clean", undefined],
        ["security_baseline", "Security baseline is clean", undefined],
        ["founder_bottleneck", "Founder bottleneck handoff recorded", undefined]
      ] as const) {
        await addStartupEvidence({
          cwd: workspace,
          type,
          summary,
          ...(content === undefined ? {} : { content }),
          goalId: created.goal.id,
          now: new Date("2026-05-14T05:02:00.000Z")
        });
      }

      for (const type of ["migration_plan", "rollback_plan", "observability"]) {
        await addStartupEvidence({
          cwd: workspace,
          type,
          summary: `${type} initially lacks quality fields`,
          goalId: created.goal.id,
          now: new Date("2026-05-14T05:03:00.000Z")
        });
      }

      await addStartupEvidence({
        cwd: workspace,
        type: "migration_plan",
        summary: "Migration plan has remediation metadata",
        content: JSON.stringify({ scope: "static local-first launch" }),
        owner: "founder",
        remediationTask: "Keep migration status current before launch",
        acceptanceCriteria: "Migration plan owner and launch validation are recorded",
        goalId: created.goal.id,
        now: new Date("2026-05-14T05:04:00.000Z")
      });
      for (const type of ["rollback_plan", "observability"]) {
        await addStartupEvidence({
          cwd: workspace,
          type,
          summary: `${type} has content quality fields`,
          content: launchRemediationContent(type),
          goalId: created.goal.id,
          now: new Date("2026-05-14T05:05:00.000Z")
        });
      }

      const verifierTask = created.generatedTasks.find(
        (task) => task.type === "run_mvp_verifiers"
      );

      if (verifierTask === undefined) {
        throw new Error("Expected build-mvp goal to create run_mvp_verifiers");
      }

      await writeVerifierArtifact({
        root: initialized.root,
        fileName: "verifier-quality-passed.json",
        exitCode: 0,
        createdAt: "2026-05-14T05:06:00.000Z"
      });
      const database = openRunsteadDatabase(initialized.stateDb);

      try {
        projectTask(database, {
          ...verifierTask,
          status: "completed",
          updatedAt: "2026-05-14T05:06:00.000Z"
        });
        projectEvidence(database, {
          id: "ev_startup_launch_quality_command_001",
          type: "command_output",
          subjectType: "task",
          subjectId: verifierTask.id,
          uri: `file://${join(
            initialized.root,
            "evidence",
            "verifier-quality-passed.json"
          )}`,
          summary: "MVP verifier commands passed",
          createdAt: "2026-05-14T05:06:00.000Z"
        });
      } finally {
        database.close();
      }

      const gate = await checkStartupGate({
        cwd: workspace,
        stage: "launch",
        domain: "ai-native-startup",
        now: new Date("2026-05-14T05:07:00.000Z")
      });

      expect(gate.passed).toBe(true);
      expect(gate.blockers).toEqual([]);
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("enforces the MVP build gate with hypotheses and disconfirming evidence", async () => {
    const workspace = join(tmpdir(), `runstead-startup-validation-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      await initRunstead({ cwd: workspace });
      await installDomainPack({
        cwd: workspace,
        ref: "ai-native-startup",
        now: new Date("2026-05-14T02:00:00.000Z")
      });
      const created = await createGoal({
        cwd: workspace,
        domain: "ai-native-startup",
        template: "validate-problem",
        now: new Date("2026-05-14T03:00:00.000Z")
      });
      const emptyGate = await checkStartupGate({
        cwd: workspace,
        stage: "mvp",
        domain: "ai-native-startup",
        now: new Date("2026-05-14T03:10:00.000Z")
      });

      expect(emptyGate.passed).toBe(false);
      expect(emptyGate.blockers).toEqual(
        expect.arrayContaining([
          "problem hypothesis is missing",
          "user hypothesis is missing",
          "solution hypothesis is missing",
          "customer, competitor, or metric validation evidence is missing",
          "disconfirming evidence is missing"
        ])
      );

      let problemHypothesisId: string | undefined;

      for (const [kind, statement] of [
        ["problem", "Founders do not trust AI-coded MVP readiness"],
        ["user", "Technical founders need an evidence-backed launch gate"],
        ["solution", "Runstead can govern AI-coded launch readiness"]
      ] as const) {
        const hypothesis = await addStartupHypothesis({
          cwd: workspace,
          kind,
          statement,
          status: "validated",
          goalId: created.goal.id,
          now: new Date("2026-05-14T03:20:00.000Z")
        });

        if (kind === "problem") {
          problemHypothesisId = hypothesis.evidence.id;
        }
      }

      if (problemHypothesisId === undefined) {
        throw new Error("Expected problem hypothesis id");
      }

      await addStartupEvidence({
        cwd: workspace,
        type: "customer_interview",
        summary: "Two founders reported launch uncertainty",
        sourceRefs: ["interview-notes:2026-05-14"],
        hypothesisId: problemHypothesisId,
        goalId: created.goal.id,
        content: JSON.stringify({
          persona: "technical founder",
          problem: "launch readiness is unverifiable after AI coding",
          summary: "Two founders wanted launch evidence before beta outreach",
          signalStrength: "strong"
        }),
        now: new Date("2026-05-14T03:30:00.000Z")
      });
      const missingDisconfirming = await checkStartupGate({
        cwd: workspace,
        stage: "mvp",
        domain: "ai-native-startup",
        now: new Date("2026-05-14T03:40:00.000Z")
      });

      expect(missingDisconfirming.passed).toBe(false);
      expect(missingDisconfirming.blockers).toEqual([
        "disconfirming evidence is missing"
      ]);

      await addStartupEvidence({
        cwd: workspace,
        type: "disconfirming",
        summary: "One founder would ship with CI only and no readiness report",
        goalId: created.goal.id,
        now: new Date("2026-05-14T03:50:00.000Z")
      });
      const passedGate = await checkStartupGate({
        cwd: workspace,
        stage: "mvp",
        domain: "ai-native-startup",
        now: new Date("2026-05-14T04:00:00.000Z")
      });

      expect(passedGate.passed).toBe(true);
      expect(passedGate.blockers).toEqual([]);
      expect(passedGate.warnings).toEqual(
        expect.arrayContaining([
          "competitor evidence is not recorded",
          "metric evidence is not recorded"
        ])
      );
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("enforces the scale ops gate with handoff evidence", async () => {
    const workspace = join(tmpdir(), `runstead-startup-scale-gate-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      await initRunstead({ cwd: workspace });
      await installDomainPack({
        cwd: workspace,
        ref: "ai-native-startup",
        now: new Date("2026-05-14T02:00:00.000Z")
      });
      const created = await createGoal({
        cwd: workspace,
        domain: "ai-native-startup",
        template: "scale-ops",
        now: new Date("2026-05-14T03:00:00.000Z")
      });
      const emptyGate = await checkStartupGate({
        cwd: workspace,
        stage: "scale",
        domain: "ai-native-startup",
        now: new Date("2026-05-14T03:10:00.000Z")
      });

      expect(emptyGate.passed).toBe(false);
      expect(emptyGate.blockers).toEqual(
        expect.arrayContaining([
          "workflow registry is missing",
          "delegation policy is missing",
          "institutional memory evidence is missing",
          "scale report schedule is missing",
          "recurring ops report is missing",
          "integration depth map is missing",
          "ops SOP evidence is missing",
          "support triage evidence is missing",
          "GTM artifact verification is missing"
        ])
      );

      for (const [type, summary] of [
        ["founder_bottleneck", "Founder-only decisions are mapped"],
        ["workflow_registry", "Recurring workflows are registered"],
        ["delegation_policy", "Agent delegation boundaries are recorded"],
        ["institutional_memory", "Founder context is captured"],
        ["ops_schedule", "Weekly scale report schedule is recorded"],
        ["ops_report", "Weekly ops report generated"],
        ["integration_map", "Customer workflow integrations are mapped"],
        ["ops_sop", "Support SOP is generated"],
        ["support_triage", "Support request triaged"],
        ["gtm_artifact", "GTM claims verified"]
      ] as const) {
        await addStartupEvidence({
          cwd: workspace,
          type,
          summary,
          content: scaleEvidenceContent(type),
          goalId: created.goal.id,
          now: new Date("2026-05-14T03:20:00.000Z")
        });
      }

      const passedGate = await checkStartupGate({
        cwd: workspace,
        stage: "scale",
        domain: "ai-native-startup",
        now: new Date("2026-05-14T03:30:00.000Z")
      });

      expect(passedGate.passed).toBe(true);
      expect(passedGate.blockers).toEqual([]);
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("explains unresolved hypothesis status and disconfirming blockers", async () => {
    const workspace = join(tmpdir(), `runstead-startup-hypothesis-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      await initRunstead({ cwd: workspace });
      await installDomainPack({
        cwd: workspace,
        ref: "ai-native-startup",
        now: new Date("2026-05-14T02:00:00.000Z")
      });
      const created = await createGoal({
        cwd: workspace,
        domain: "ai-native-startup",
        template: "validate-problem",
        now: new Date("2026-05-14T03:00:00.000Z")
      });
      const problemHypothesis = await addStartupHypothesis({
        cwd: workspace,
        kind: "problem",
        statement: "Founders cannot trust agent-produced MVP readiness",
        status: "validated",
        goalId: created.goal.id,
        now: new Date("2026-05-14T03:10:00.000Z")
      });

      await addStartupHypothesis({
        cwd: workspace,
        kind: "user",
        statement: "Technical founders will use a launch gate",
        status: "needs-more-evidence",
        goalId: created.goal.id,
        now: new Date("2026-05-14T03:11:00.000Z")
      });
      await addStartupHypothesis({
        cwd: workspace,
        kind: "solution",
        statement: "Runstead launch gate is the right MVP",
        status: "validated",
        goalId: created.goal.id,
        now: new Date("2026-05-14T03:12:00.000Z")
      });
      await addStartupEvidence({
        cwd: workspace,
        type: "customer_interview",
        summary: "Founder wants evidence before launch",
        sourceRefs: ["interview:founder-a"],
        hypothesisId: problemHypothesis.evidence.id,
        goalId: created.goal.id,
        content: JSON.stringify({
          persona: "technical founder",
          problem: "agent-coded launch readiness is hard to trust",
          summary: "Founder wants evidence before launch",
          signalStrength: "strong"
        }),
        now: new Date("2026-05-14T03:13:00.000Z")
      });
      await addStartupEvidence({
        cwd: workspace,
        type: "disconfirming",
        summary: "A founder would ignore the readiness report",
        sourceRefs: ["interview:founder-b"],
        goalId: created.goal.id,
        content: JSON.stringify({
          impact: "blocker",
          reason: "The target persona may not trust generated reports"
        }),
        now: new Date("2026-05-14T03:14:00.000Z")
      });

      const gate = await checkStartupGate({
        cwd: workspace,
        stage: "mvp",
        domain: "ai-native-startup",
        now: new Date("2026-05-14T03:20:00.000Z")
      });

      expect(gate.passed).toBe(false);
      expect(gate.blockers).toEqual(
        expect.arrayContaining([
          "user hypothesis needs more evidence",
          "disconfirming evidence blocks MVP build: A founder would ignore the readiness report"
        ])
      );
      expect(formatStartupGateCheckResult(gate)).toContain(
        "MVP build cannot start until each blocker has evidence"
      );
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("records gate waivers, freshness warnings, gate diffs, and release decisions", async () => {
    const workspace = join(tmpdir(), `runstead-startup-gate-engine-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      await initRunstead({ cwd: workspace });
      await installDomainPack({
        cwd: workspace,
        ref: "ai-native-startup",
        now: new Date("2026-05-14T00:00:00.000Z")
      });
      await addStartupEvidence({
        cwd: workspace,
        type: "metric_snapshot",
        summary: "Activation metric is stale",
        sources: [
          {
            uri: "posthog:activation",
            kind: "posthog",
            capturedAt: "2026-04-01T00:00:00.000Z",
            freshnessDays: 7
          }
        ],
        content: JSON.stringify({
          source: "posthog",
          threshold: "0.4",
          current: "0.5"
        }),
        now: new Date("2026-05-14T00:05:00.000Z")
      });

      const firstGate = await checkStartupGate({
        cwd: workspace,
        stage: "launch",
        now: new Date("2026-05-14T00:10:00.000Z")
      });

      expect(firstGate.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            severity: "critical",
            message: "measurement framework is missing",
            waived: false
          })
        ])
      );
      expect(firstGate.diff.addedBlockers).toContain(
        "measurement framework is missing"
      );
      expect(firstGate.warnings).toEqual(
        expect.arrayContaining([
          expect.stringContaining("stale evidence source for startup_metric_snapshot")
        ])
      );

      const waiver = await recordStartupGateDecision({
        cwd: workspace,
        stage: "launch",
        decision: "waive_blocker",
        blocker: "measurement framework is missing",
        owner: "founder",
        reason: "Temporary launch rehearsal uses manually recorded metric contract",
        expiresAt: "2026-05-21T00:00:00.000Z",
        now: new Date("2026-05-14T00:15:00.000Z")
      });
      const secondGate = await checkStartupGate({
        cwd: workspace,
        stage: "launch",
        now: new Date("2026-05-14T00:20:00.000Z")
      });

      expect(secondGate.blockers).not.toContain("measurement framework is missing");
      expect(secondGate.waivedBlockers).toEqual([
        expect.objectContaining({
          evidenceId: waiver.evidence.id,
          blocker: "measurement framework is missing",
          owner: "founder"
        })
      ]);
      expect(secondGate.diff.previousEventId).toBe(firstGate.event.eventId);
      expect(secondGate.diff.resolvedBlockers).toContain(
        "measurement framework is missing"
      );
      expect(formatStartupGateCheckResult(secondGate)).toContain(
        "[critical] measurement framework is missing (waived)"
      );

      const decision = await recordStartupGateDecision({
        cwd: workspace,
        stage: "launch",
        decision: "launch_with_accepted_debt",
        owner: "founder",
        reason: "Remaining risks have owners and expiry dates",
        now: new Date("2026-05-14T00:25:00.000Z")
      });
      const artifact = JSON.parse(await readFile(decision.artifactPath, "utf8")) as {
        content: string;
      };

      expect(JSON.parse(artifact.content)).toMatchObject({
        kind: "release_decision",
        gate: "launch",
        decision: "launch_with_accepted_debt",
        owner: "founder"
      });
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});

function projectTask(
  database: ReturnType<typeof openRunsteadDatabase>,
  task: Task
): void {
  appendEventAndProject(database, {
    event: {
      eventId: `evt_${task.id}`,
      type: "task.updated",
      aggregateType: "task",
      aggregateId: task.id,
      payload: {
        status: task.status
      },
      createdAt: task.updatedAt
    },
    projection: {
      type: "task",
      value: task
    }
  });
}

function projectEvidence(
  database: ReturnType<typeof openRunsteadDatabase>,
  evidence: Evidence
): void {
  appendEventAndProject(database, {
    event: {
      eventId: `evt_${evidence.id}`,
      type: "evidence.recorded",
      aggregateType: "evidence",
      aggregateId: evidence.id,
      payload: {
        evidenceId: evidence.id
      },
      createdAt: evidence.createdAt
    },
    projection: {
      type: "evidence",
      value: evidence
    }
  });
}

function launchRemediationContent(type: string): string {
  return JSON.stringify({
    owner: "founder",
    remediationTask: `Maintain ${type} evidence for launch readiness`,
    acceptanceCriteria: `${type} evidence is reviewed before launch`
  });
}

function scaleEvidenceContent(type: string): string {
  if (type === "founder_bottleneck") {
    return JSON.stringify({
      status: "handoff-complete",
      handoffDueDate: "2026-05-13"
    });
  }

  if (type === "delegation_policy") {
    return JSON.stringify({
      allowedAgents: ["codex_cli"],
      constrainedTaskTypes: ["startup_remediation"]
    });
  }

  if (type === "integration_map") {
    return JSON.stringify({
      adoptionSignals: ["Two customers use the integration weekly"],
      workflowSignals: ["Launch review starts from the integration"]
    });
  }

  if (type === "gtm_artifact") {
    return JSON.stringify({
      evidenceRefs: ["startup:metric"],
      productState: "beta"
    });
  }

  return JSON.stringify({ recorded: true });
}

async function writeVerifierArtifact(input: {
  root: string;
  fileName: string;
  exitCode: number;
  createdAt: string;
}): Promise<void> {
  const evidenceDir = join(input.root, "evidence");

  await mkdir(evidenceDir, { recursive: true });
  await writeFile(
    join(evidenceDir, input.fileName),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        createdAt: input.createdAt,
        result: {
          exitCode: input.exitCode,
          timedOut: false,
          forceKilled: false
        }
      },
      null,
      2
    )}\n`,
    "utf8"
  );
}
