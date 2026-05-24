import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { appendEventAndProject, openRunsteadDatabase } from "@runstead/state-sqlite";
import { describe, expect, it } from "vitest";

import {
  generateFounderBottleneckMap,
  generateRepoReadinessAudit,
  generateSecurityBaseline
} from "./startup-automation.js";
import {
  formatStartupCompleteProductCheck,
  generateStartupCompleteProductCheck
} from "./startup-complete-check.js";
import { addStartupEvidence } from "./startup-evidence.js";
import { startupOnboard } from "./startup-founder-flow.js";
import { recordStartupMetricSnapshot } from "./startup-metrics.js";
import { recordStartupSourceEvidence } from "./startup-source-connectors.js";
import { storeCommandVerifierEvidence } from "./verifier-evidence.js";

describe("generateStartupCompleteProductCheck", () => {
  it("writes a minimal complete product audit across evidence, surfaces, and events", async () => {
    const workspace = join(tmpdir(), `runstead-complete-check-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      await mkdir(workspace, { recursive: true });
      await writeFile(
        join(workspace, "package.json"),
        `${JSON.stringify(
          {
            name: "complete-product-fixture",
            private: true,
            packageManager: "pnpm@11.1.1",
            scripts: {
              test: "node test.js",
              lint: "node lint.js",
              typecheck: "node typecheck.js",
              build: "node build.js"
            }
          },
          null,
          2
        )}\n`,
        "utf8"
      );

      const onboard = await startupOnboard({
        cwd: workspace,
        force: true,
        writeCi: true,
        now: new Date("2026-05-14T01:00:00.000Z")
      });
      const verifierTask = onboard.init.generatedTasks.find(
        (task) => task.type === "run_mvp_verifiers"
      );

      if (verifierTask === undefined) {
        throw new Error("Expected startup init to generate verifier task");
      }

      const completedVerifierTask = {
        ...verifierTask,
        status: "completed" as const,
        updatedAt: "2026-05-14T01:10:00.000Z"
      };
      const database = openRunsteadDatabase(onboard.init.stateDb);

      try {
        appendEventAndProject(database, {
          event: {
            eventId: "evt_complete_check_verifier_task",
            type: "task.updated",
            aggregateType: "task",
            aggregateId: completedVerifierTask.id,
            payload: {
              status: completedVerifierTask.status
            },
            createdAt: completedVerifierTask.updatedAt
          },
          projection: {
            type: "task",
            value: completedVerifierTask
          }
        });
        await storeCommandVerifierEvidence({
          cwd: workspace,
          runsteadRoot: onboard.root,
          database,
          task: completedVerifierTask,
          command: {
            name: "test",
            command: 'node -e "process.exit(0)"'
          },
          now: new Date("2026-05-14T01:11:00.000Z")
        });
      } finally {
        database.close();
      }

      await generateSecurityBaseline({
        cwd: workspace,
        now: new Date("2026-05-14T01:12:00.000Z")
      });
      await generateRepoReadinessAudit({
        cwd: workspace,
        now: new Date("2026-05-14T01:12:30.000Z")
      });
      await recordStartupMetricSnapshot({
        cwd: workspace,
        metric: "activation",
        source: "PostHog",
        threshold: "0.5",
        current: "0.7",
        sources: [
          {
            kind: "posthog",
            uri: "https://posthog.example/project/1/insights/activation",
            capturedAt: "2026-05-14T01:13:00.000Z",
            freshnessDays: 7,
            hash: "sha256:activation"
          }
        ],
        now: new Date("2026-05-14T01:13:00.000Z")
      });
      await addLaunchQualityEvidence(workspace, "migration_plan");
      await addLaunchQualityEvidence(workspace, "rollback_plan");
      await addLaunchQualityEvidence(workspace, "observability");
      await addLaunchQualityEvidence(workspace, "release_plan");
      await recordStartupSourceEvidence({
        cwd: workspace,
        connector: "deployment",
        uri: "https://vercel.example/complete-product",
        summary: "Production deployment and rollback target recorded",
        status: "ready",
        capturedAt: "2026-05-14T01:17:00.000Z",
        freshnessDays: 7,
        sourceHash: "sha256:deployment",
        trustLevel: "high",
        now: new Date("2026-05-14T01:17:00.000Z")
      });
      await generateFounderBottleneckMap({
        cwd: workspace,
        bottlenecks: ["Support escalation owner is documented"],
        owner: "founder",
        systemOfRecord: "Runstead evidence ledger",
        status: "handoff-complete",
        now: new Date("2026-05-14T01:18:00.000Z")
      });

      const result = await generateStartupCompleteProductCheck({
        cwd: workspace,
        target: "local",
        now: new Date("2026-05-14T02:00:00.000Z")
      });
      const markdown = await readFile(result.markdownPath, "utf8");
      const json = JSON.parse(await readFile(result.jsonPath, "utf8")) as {
        kind: string;
        data: {
          status: string;
          criteria: { id: string; status: string }[];
          surfaces: Record<string, string>;
          ci: {
            releaseDecision: {
              status: string;
            };
          };
        };
      };

      expect(result.status).toBe("complete");
      expect(result.score).toBe(1);
      expect(result.criteria.map((criterion) => criterion.id)).toEqual(
        expect.arrayContaining([
          "founder_golden_path",
          "repo_discovery_and_risk",
          "launch_readiness_report",
          "blocker_accountability",
          "remediation_loop",
          "review_surfaces",
          "ci_pr_gate",
          "operations_resume_audit",
          "artifact_truth"
        ])
      );
      expect(result.criteria.every((criterion) => criterion.status === "passed")).toBe(
        true
      );
      expect(result.blockers).toEqual([]);
      expect(markdown).toBe(result.markdown);
      expect(markdown).toContain("# Runstead Startup Complete Product Check");
      expect(markdown).toContain("Status: complete");
      expect(markdown).toContain("Artifact State Evidence Event Truth");
      expect(json.kind).toBe("startup_complete_product_check");
      expect(json.data.status).toBe("complete");
      expect(json.data.ci.releaseDecision.status).toBe("allow_release");
      expect(json.data.surfaces.launchReportJson).toContain(
        "launch-readiness-ai-native-startup.json"
      );
      expect(formatStartupCompleteProductCheck(result)).toContain(
        "Dashboard Markdown JSON Review"
      );

      const auditDatabase = openRunsteadDatabase(result.stateDb);

      try {
        const event = auditDatabase
          .prepare(
            `
            SELECT type, aggregate_type, aggregate_id, payload_json
            FROM events
            WHERE event_id = ?
          `
          )
          .get(result.event.eventId) as
          | {
              type: string;
              aggregate_type: string;
              aggregate_id: string;
              payload_json: string;
            }
          | undefined;
        const evidence = auditDatabase
          .prepare("SELECT type, summary FROM evidence WHERE id = ?")
          .get(result.evidenceId) as
          | {
              type: string;
              summary: string;
            }
          | undefined;

        expect(event).toMatchObject({
          type: "startup_complete_product.checked",
          aggregate_type: "startup_complete_product",
          aggregate_id: "ai-native-startup"
        });
        expect(JSON.parse(event?.payload_json ?? "{}")).toMatchObject({
          status: "complete",
          evidenceId: result.evidenceId
        });
        expect(evidence).toMatchObject({
          type: "startup_complete_product_check",
          summary: "Startup complete product check: complete"
        });
      } finally {
        auditDatabase.close();
      }
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  }, 30_000);

  it("keeps release planning separate from deployment verification", async () => {
    const workspace = join(
      tmpdir(),
      `runstead-complete-check-release-only-${process.pid}`
    );

    try {
      await rm(workspace, { force: true, recursive: true });
      await mkdir(workspace, { recursive: true });
      await writeFile(
        join(workspace, "package.json"),
        `${JSON.stringify(
          {
            name: "complete-product-release-only-fixture",
            private: true,
            packageManager: "pnpm@11.1.1",
            scripts: {
              test: "node test.js",
              lint: "node lint.js",
              typecheck: "node typecheck.js",
              build: "node build.js"
            }
          },
          null,
          2
        )}\n`,
        "utf8"
      );

      const onboard = await startupOnboard({
        cwd: workspace,
        force: true,
        writeCi: true,
        now: new Date("2026-05-14T03:00:00.000Z")
      });
      const verifierTask = onboard.init.generatedTasks.find(
        (task) => task.type === "run_mvp_verifiers"
      );

      if (verifierTask === undefined) {
        throw new Error("Expected startup init to generate verifier task");
      }

      const completedVerifierTask = {
        ...verifierTask,
        status: "completed" as const,
        updatedAt: "2026-05-14T03:10:00.000Z"
      };
      const database = openRunsteadDatabase(onboard.init.stateDb);

      try {
        appendEventAndProject(database, {
          event: {
            eventId: "evt_complete_check_release_only_verifier_task",
            type: "task.updated",
            aggregateType: "task",
            aggregateId: completedVerifierTask.id,
            payload: {
              status: completedVerifierTask.status
            },
            createdAt: completedVerifierTask.updatedAt
          },
          projection: {
            type: "task",
            value: completedVerifierTask
          }
        });
        await storeCommandVerifierEvidence({
          cwd: workspace,
          runsteadRoot: onboard.root,
          database,
          task: completedVerifierTask,
          command: {
            name: "test",
            command: 'node -e "process.exit(0)"'
          },
          now: new Date("2026-05-14T03:11:00.000Z")
        });
      } finally {
        database.close();
      }

      await generateSecurityBaseline({
        cwd: workspace,
        now: new Date("2026-05-14T03:12:00.000Z")
      });
      await generateRepoReadinessAudit({
        cwd: workspace,
        now: new Date("2026-05-14T03:12:30.000Z")
      });
      await recordStartupMetricSnapshot({
        cwd: workspace,
        metric: "activation",
        source: "PostHog",
        threshold: "0.5",
        current: "0.7",
        sources: [
          {
            kind: "posthog",
            uri: "https://posthog.example/project/1/insights/activation",
            capturedAt: "2026-05-14T03:13:00.000Z",
            freshnessDays: 7,
            hash: "sha256:activation"
          }
        ],
        now: new Date("2026-05-14T03:13:00.000Z")
      });
      await addLaunchQualityEvidence(workspace, "migration_plan");
      await addLaunchQualityEvidence(workspace, "rollback_plan");
      await addLaunchQualityEvidence(workspace, "observability");
      await addLaunchQualityEvidence(workspace, "release_plan");
      await generateFounderBottleneckMap({
        cwd: workspace,
        bottlenecks: ["Support escalation owner is documented"],
        owner: "founder",
        systemOfRecord: "Runstead evidence ledger",
        status: "handoff-complete",
        now: new Date("2026-05-14T03:18:00.000Z")
      });

      const result = await generateStartupCompleteProductCheck({
        cwd: workspace,
        now: new Date("2026-05-14T04:00:00.000Z")
      });
      const repoCriterion = result.criteria.find(
        (criterion) => criterion.id === "repo_discovery_and_risk"
      );

      expect(result.status).toBe("incomplete");
      expect(repoCriterion).toMatchObject({
        status: "blocked",
        missing: ["deployment verification evidence"]
      });
      expect(repoCriterion?.evidence).toContain("deployment=missing");
      expect(result.markdown).toContain("deployment verification evidence");
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});

async function addLaunchQualityEvidence(
  workspace: string,
  type: "migration_plan" | "rollback_plan" | "observability" | "release_plan"
): Promise<void> {
  await addStartupEvidence({
    cwd: workspace,
    type,
    summary: `${type.replace("_", " ")} recorded`,
    owner: "founder",
    remediationTask: `Maintain ${type.replace("_", " ")} before launch`,
    acceptanceCriteria: `${type.replace("_", " ")} stays current for release`,
    sources: [
      {
        kind: "runbook",
        uri: `file:///${type}.md`,
        capturedAt: "2026-05-14T01:16:00.000Z",
        freshnessDays: 30,
        hash: `sha256:${type}`
      }
    ],
    content: JSON.stringify(
      {
        owner: "founder",
        remediationTask: `Maintain ${type.replace("_", " ")} before launch`,
        acceptanceCriteria: `${type.replace("_", " ")} stays current for release`
      },
      null,
      2
    ),
    now: new Date("2026-05-14T01:16:00.000Z")
  });
}
