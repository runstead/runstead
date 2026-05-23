import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openRunsteadDatabase } from "@runstead/state-sqlite";
import { describe, expect, it } from "vitest";

import {
  approvalActionMetadata,
  decideApproval,
  findApprovedApprovalForAction,
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
        resource: {
          type: "pull_request",
          id: "main...runstead/task_001"
        },
        context: {
          filesTouched: ["src/app.ts", "package.json"],
          diffHash: "a".repeat(64),
          dependencyImpact: {
            kind: "dependency_files_touched",
            files: ["package.json"]
          },
          riskSummary: "Patch touches dependency files: package.json.",
          canonicalSignature: "b".repeat(64),
          sideEffects: ["github_pr_create"]
        }
      };
      const policyResult = evaluatePolicy({ policy, action });
      const recorded = recordPolicyDecision({
        cwd: workspace,
        policyId: policy.id,
        policyFingerprint: "policy_fp_test",
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
          actionId: "act_approval_test",
          expiresAt: "2026-05-15T10:01:00.000Z"
        });
        expect(shown.policyDecision).toMatchObject({
          policyId: policy.id,
          action: {
            actionType: "github.pr.create",
            resource: {
              type: "pull_request",
              id: "main...runstead/task_001"
            }
          },
          result: {
            policyFingerprint: "policy_fp_test"
          }
        });
        expect(approvalActionMetadata(shown.policyDecision)).toEqual({
          filesTouched: ["src/app.ts", "package.json"],
          dependencyImpact: {
            kind: "dependency_files_touched",
            files: ["package.json"]
          },
          diffHash: "a".repeat(64),
          canonicalSignature: "b".repeat(64),
          riskSummary: "Patch touches dependency files: package.json."
        });
        const event = database
          .prepare(
            `
            SELECT payload_json
            FROM events
            WHERE type = 'approval.requested' AND aggregate_id = ?
          `
          )
          .get(approval.id) as { payload_json: string } | undefined;
        const payload = JSON.parse(event?.payload_json ?? "{}") as {
          obligations?: unknown;
        };

        expect(payload).toMatchObject({
          approvalId: approval.id,
          expiresAt: "2026-05-15T10:01:00.000Z",
          policyId: policy.id,
          policyFingerprint: "policy_fp_test",
          action: {
            actionType: "github.pr.create",
            resource: {
              type: "pull_request",
              id: "main...runstead/task_001"
            }
          }
        });
        expect(payload.obligations).toEqual([]);
      } finally {
        database.close();
      }

      const decided = await decideApproval({
        cwd: workspace,
        id: approvalId,
        decision: "approved",
        decidedBy: "local-admin",
        now: new Date("2026-05-14T10:02:00.000Z")
      });

      expect(decided.approval).toMatchObject({
        status: "approved",
        decidedBy: "local-admin",
        decidedAt: "2026-05-14T10:02:00.000Z"
      });
      expect(listApprovals({ cwd: workspace, status: "pending" }).approvals).toEqual(
        []
      );
      await expect(
        decideApproval({
          cwd: workspace,
          id: decided.approval.id,
          decision: "denied"
        })
      ).rejects.toThrow(
        `Approval ${decided.approval.id} is approved, expected pending`
      );
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("requires approval.decide permission for explicit approvers", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-approval-rbac-"));

    try {
      const initialized = await initRunstead({ cwd: workspace });
      const policy = createExternalWriteApprovalPolicy();
      const action = {
        actionId: "act_approval_rbac_test",
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
        now: new Date("2026-05-14T10:10:00.000Z")
      });
      const database = openRunsteadDatabase(initialized.stateDb);
      let approvalId = "";

      try {
        approvalId = requestApproval({
          database,
          policyDecision: recorded.decision,
          requestedBy: "worker:test",
          now: new Date("2026-05-14T10:11:00.000Z")
        }).id;
      } finally {
        database.close();
      }

      await expect(
        decideApproval({
          cwd: workspace,
          id: approvalId,
          decision: "approved",
          decidedBy: "mallory",
          now: new Date("2026-05-14T10:12:00.000Z")
        })
      ).rejects.toThrow("Subject mallory cannot decide approvals");
      expect(showApproval({ cwd: workspace, id: approvalId }).approval.status).toBe(
        "pending"
      );
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("expires approved grants when they age out before use", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-approval-expiry-"));

    try {
      const initialized = await initRunstead({ cwd: workspace });
      const policy = createExternalWriteApprovalPolicy();
      const action = {
        actionId: "act_approval_expiry_test",
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
        now: new Date("2026-05-14T11:00:00.000Z")
      });
      const database = openRunsteadDatabase(initialized.stateDb);
      let approvalId = "";

      try {
        approvalId = requestApproval({
          database,
          policyDecision: recorded.decision,
          now: new Date("2026-05-14T11:01:00.000Z")
        }).id;
      } finally {
        database.close();
      }

      await decideApproval({
        cwd: workspace,
        id: approvalId,
        decision: "approved",
        now: new Date("2026-05-14T11:02:00.000Z")
      });

      const expiryDatabase = openRunsteadDatabase(initialized.stateDb);

      try {
        expect(
          findApprovedApprovalForAction({
            database: expiryDatabase,
            actionId: "act_approval_expiry_test",
            now: new Date("2026-05-15T11:01:01.000Z")
          })
        ).toBeUndefined();

        const expired = showApproval({ cwd: workspace, id: approvalId }).approval;
        expect(expired.status).toBe("expired");
        const event = expiryDatabase
          .prepare(
            `
            SELECT payload_json
            FROM events
            WHERE type = 'approval.expired' AND aggregate_id = ?
          `
          )
          .get(approvalId) as { payload_json: string } | undefined;

        expect(JSON.parse(event?.payload_json ?? "{}")).toMatchObject({
          approvalId,
          status: "expired",
          expiresAt: "2026-05-15T11:01:00.000Z"
        });
      } finally {
        expiryDatabase.close();
      }
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});
