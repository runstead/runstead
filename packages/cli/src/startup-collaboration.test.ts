import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openRunsteadDatabase } from "@runstead/state-sqlite";
import { describe, expect, it } from "vitest";

import { requestApproval } from "./approvals.js";
import { recordPolicyDecision } from "./policy-log.js";
import { createExternalWriteApprovalPolicy, evaluatePolicy } from "./policy.js";
import { generateStartupCollaborationDigest } from "./startup-collaboration.js";
import { initStartup } from "./startup-automation.js";
import { recordStartupGateDecision } from "./startup-evidence.js";

describe("startup collaboration digest", () => {
  it("exports pending approvals, risk acceptances, reminders, and role views", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-startup-team-"));

    try {
      const initialized = await initStartup({
        cwd: workspace,
        stage: "launch",
        now: new Date("2026-05-14T08:00:00.000Z")
      });
      const policy = createExternalWriteApprovalPolicy();
      const action = {
        actionId: "act_team_digest_pr",
        actionType: "github.pr.create",
        resource: {
          type: "pull_request",
          id: "main...launch"
        },
        context: {
          sideEffects: ["github_pr_create"]
        }
      };
      const policyResult = evaluatePolicy({ policy, action });
      const recorded = recordPolicyDecision({
        cwd: workspace,
        policyId: policy.id,
        policyFingerprint: "policy_fp_team_digest",
        action,
        result: policyResult,
        now: new Date("2026-05-14T08:05:00.000Z")
      });
      const database = openRunsteadDatabase(initialized.stateDb);

      try {
        requestApproval({
          database,
          policyDecision: recorded.decision,
          requestedBy: "worker:codex_cli",
          expiresAt: "2026-05-16T08:05:00.000Z",
          now: new Date("2026-05-14T08:06:00.000Z")
        });
      } finally {
        database.close();
      }

      await recordStartupGateDecision({
        cwd: workspace,
        stage: "launch",
        decision: "waive_blocker",
        blocker: "observability evidence is missing",
        owner: "founder",
        reason: "beta launch is limited to internal accounts",
        comment: "security reviewer accepts two-day waiver",
        expiresAt: "2026-05-16T09:00:00.000Z",
        now: new Date("2026-05-14T08:10:00.000Z")
      });

      const digest = await generateStartupCollaborationDigest({
        cwd: workspace,
        owner: "founder",
        reviewer: "security",
        notify: ["slack:#launch", "github:pr-comment"],
        expiryWindowDays: 3,
        now: new Date("2026-05-14T08:15:00.000Z")
      });
      const markdown = await readFile(digest.files[0] ?? "", "utf8");
      const json = await readFile(digest.jsonPath, "utf8");

      expect(digest.pendingApprovals).toHaveLength(1);
      expect(digest.riskAcceptances).toEqual([
        expect.objectContaining({
          owner: "founder",
          blocker: "observability evidence is missing",
          comment: "security reviewer accepts two-day waiver"
        })
      ]);
      expect(digest.expiryReminders).toEqual(
        expect.arrayContaining([
          expect.stringContaining("approval"),
          expect.stringContaining("risk acceptance")
        ])
      );
      expect(markdown).toContain("Startup Team Collaboration Digest");
      expect(markdown).toContain("securityReviewer");
      expect(markdown).toContain("slack:#launch");
      expect(json).toContain('"reviewer": "security"');
      expect(digest.evidenceId).toMatch(/^ev_/);
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});
