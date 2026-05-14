import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openRunsteadDatabase } from "@runstead/state-sqlite";
import { describe, expect, it } from "vitest";

import { recordPolicyDecision } from "./policy-log.js";
import {
  createExternalWriteApprovalPolicy,
  evaluatePolicy,
  fingerprintPolicyProfile
} from "./policy.js";

describe("recordPolicyDecision", () => {
  it("stores a policy decision projection and appends an audit event", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-policy-log-"));
    const stateDb = join(workspace, ".runstead", "state.db");
    const policy = createExternalWriteApprovalPolicy();
    const action = {
      actionId: "act_external_write",
      actionType: "github.pr.create",
      context: {
        sideEffects: ["github_pr_create"]
      }
    };
    const result = evaluatePolicy({ policy, action });

    try {
      const recorded = recordPolicyDecision({
        stateDb,
        policyId: policy.id,
        policyFingerprint: fingerprintPolicyProfile(policy),
        action,
        result,
        now: new Date("2026-05-14T03:07:00.000Z")
      });
      const database = openRunsteadDatabase(stateDb);

      try {
        const decision = database
          .prepare(
            `
            SELECT id, action_id, policy_id, decision, risk, rule_id,
                   result_json, created_at
            FROM policy_decisions
            WHERE id = ?
          `
          )
          .get(recorded.decision.id) as {
          id: string;
          action_id: string;
          policy_id: string;
          decision: string;
          risk: string;
          rule_id: string;
          result_json: string;
          created_at: string;
        };
        const event = database
          .prepare(
            `
            SELECT type, aggregate_type, aggregate_id, payload_json
            FROM events
            WHERE aggregate_id = ?
          `
          )
          .get(recorded.decision.id) as {
          type: string;
          aggregate_type: string;
          aggregate_id: string;
          payload_json: string;
        };

        expect(decision).toMatchObject({
          id: recorded.decision.id,
          action_id: "act_external_write",
          policy_id: policy.id,
          decision: "require_approval",
          risk: "high",
          rule_id: "require_approval_external_write",
          created_at: "2026-05-14T03:07:00.000Z"
        });
        expect(JSON.parse(decision.result_json)).toMatchObject({
          matchedSideEffect: "github_pr_create",
          policyFingerprint: fingerprintPolicyProfile(policy)
        });
        expect(event).toMatchObject({
          type: "policy.decision_recorded",
          aggregate_type: "policy_decision",
          aggregate_id: recorded.decision.id
        });
        expect(JSON.parse(event.payload_json)).toMatchObject({
          actionId: "act_external_write",
          policyId: policy.id,
          policyFingerprint: fingerprintPolicyProfile(policy),
          decision: "require_approval"
        });
      } finally {
        database.close();
      }
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("stores policy decisions in legacy .team state by default", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-policy-team-"));
    const policy = createExternalWriteApprovalPolicy();
    const action = {
      actionId: "act_external_write_team",
      actionType: "github.pr.create",
      context: {
        sideEffects: ["github_pr_create"]
      }
    };
    const result = evaluatePolicy({ policy, action });

    try {
      await mkdir(join(workspace, ".team"), { recursive: true });
      await writeFile(join(workspace, ".team", "config.yaml"), "version: 1\n");
      openRunsteadDatabase(join(workspace, ".team", "state.db")).close();

      const recorded = recordPolicyDecision({
        cwd: workspace,
        policyId: policy.id,
        action,
        result,
        now: new Date("2026-05-14T03:08:00.000Z")
      });
      const database = openRunsteadDatabase(join(workspace, ".team", "state.db"));

      try {
        const decision = database
          .prepare("SELECT action_id, policy_id, decision FROM policy_decisions")
          .get() as {
          action_id: string;
          policy_id: string;
          decision: string;
        };

        expect(recorded.stateDb).toBe(join(workspace, ".team", "state.db"));
        expect(decision).toEqual({
          action_id: "act_external_write_team",
          policy_id: policy.id,
          decision: "require_approval"
        });
      } finally {
        database.close();
      }
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});
