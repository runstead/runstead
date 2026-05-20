import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openRunsteadDatabase } from "@runstead/state-sqlite";
import { describe, expect, it } from "vitest";

import { installDomainPack } from "./domain-pack-install.js";
import { createGoal } from "./goals.js";
import { initRunstead } from "./init.js";
import {
  addStartupEvidence,
  checkStartupGate,
  formatStartupGateCheckResult
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
      expect(
        JSON.parse(await readFile(customerEvidence.artifactPath, "utf8"))
      ).toMatchObject({
        evidenceType: "customer_interview",
        sourceRefs: ["interview-notes:2026-05-14"],
        associations: {
          goalId: created.goal.id
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
      const passedGate = await checkStartupGate({
        cwd: workspace,
        stage: "launch",
        domain: "ai-native-startup",
        now: new Date("2026-05-14T04:30:00.000Z")
      });

      expect(passedGate.passed).toBe(true);
      expect(passedGate.blockers).toEqual([]);
      expect(passedGate.warnings).toContain("run_mvp_verifiers has not completed");

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
          "startup_customer_interview",
          "startup_measurement_framework"
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
          }
        ]);
      } finally {
        database.close();
      }
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});
