import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openRunsteadDatabase } from "@runstead/state-sqlite";
import { describe, expect, it } from "vitest";

import {
  decideApproval,
  listApprovals,
  requestApproval,
  showApproval
} from "./approvals.js";
import { initRunstead } from "./init.js";
import { recordPolicyDecision } from "./policy-log.js";
import { createExternalWriteApprovalPolicy, evaluatePolicy } from "./policy.js";

describe("approvals", () => {
  it("requests, lists, shows, and decides approvals", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-approval-"));

    try {
      const initialized = await initRunstead({ cwd: workspace });
      const policy = createExternalWriteApprovalPolicy();
      const action = {
        actionId: "act_approval_test",
        actionType: "github.pr.create",
        context: {
          sideEffects: ["github_pr_create"]
        }
      };
      const policyResult = evaluatePolicy({ policy, action });
      const recorded = recordPolicyDecision({
        cwd: workspace,
        policyId: policy.id,
        action,
        result: policyResult,
        now: new Date("2026-05-14T10:00:00.000Z")
      });
      const database = openRunsteadDatabase(initialized.stateDb);
      let approvalId = "";

      try {
        const approval = requestApproval({
          database,
          policyDecision: recorded.decision,
          requestedBy: "worker:test",
          now: new Date("2026-05-14T10:01:00.000Z")
        });
        approvalId = approval.id;
        const listed = listApprovals({ cwd: workspace });
        const pending = listApprovals({ cwd: workspace, status: "pending" });
        const shown = showApproval({ cwd: workspace, id: approval.id });

        expect(listed.approvals.map((item) => item.id)).toEqual([approval.id]);
        expect(pending.approvals).toHaveLength(1);
        expect(shown.approval).toMatchObject({
          id: approval.id,
          status: "pending",
          requestedBy: "worker:test",
          actionId: "act_approval_test"
        });
      } finally {
        database.close();
      }

      const decided = decideApproval({
        cwd: workspace,
        id: approvalId,
        decision: "approved",
        decidedBy: "alice",
        now: new Date("2026-05-14T10:02:00.000Z")
      });

      expect(decided.approval).toMatchObject({
        status: "approved",
        decidedBy: "alice",
        decidedAt: "2026-05-14T10:02:00.000Z"
      });
      expect(listApprovals({ cwd: workspace, status: "pending" }).approvals).toEqual(
        []
      );
      expect(() =>
        decideApproval({
          cwd: workspace,
          id: decided.approval.id,
          decision: "denied"
        })
      ).toThrow(`Approval ${decided.approval.id} is approved, expected pending`);
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});
