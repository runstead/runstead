import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openRunsteadDatabase } from "@runstead/state-sqlite";
import { describe, expect, it } from "vitest";

import { loadPolicyProfileFromFile } from "./policy-loader.js";
import { evaluatePolicy } from "./policy.js";
import {
  compileTeamPolicy,
  formatTeamPolicySummary,
  initTeamPolicy
} from "./team-policy.js";

describe("team policy", () => {
  it("initializes and compiles a team policy into the Policy DSL", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-team-policy-"));
    const root = join(workspace, ".runstead");

    try {
      await mkdir(root, { recursive: true });
      await writeFile(
        join(root, "config.yaml"),
        "version: 1\ndomain: repo-maintenance\n",
        "utf8"
      );
      openRunsteadDatabase(join(root, "state.db")).close();

      const initialized = await initTeamPolicy({ cwd: workspace });
      const compiled = await compileTeamPolicy({
        cwd: workspace,
        now: new Date("2026-05-14T07:30:00.000Z")
      });
      const compiledYaml = await readFile(compiled.outputPath, "utf8");
      const loadedPolicy = await loadPolicyProfileFromFile(compiled.outputPath);
      const protectedPathDecision = evaluatePolicy({
        policy: loadedPolicy,
        action: {
          actionId: "act_secret_read",
          actionType: "filesystem.read",
          resource: {
            type: "file",
            path: ".env"
          }
        }
      });
      const externalWriteDecision = evaluatePolicy({
        policy: loadedPolicy,
        action: {
          actionId: "act_pr_create",
          actionType: "github.pr.create",
          context: {
            sideEffects: ["github_pr_create"]
          }
        }
      });

      expect(initialized.overwritten).toBe(false);
      expect(formatTeamPolicySummary(initialized.policy)).toContain(
        "Protected paths: 4"
      );
      expect(compiled.outputPath).toBe(join(root, "policies", "team-policy.yaml"));
      expect(compiledYaml).toContain("deny_protected_paths");
      expect(protectedPathDecision).toMatchObject({
        decision: "deny",
        risk: "critical",
        ruleId: "deny_protected_paths"
      });
      expect(externalWriteDecision).toMatchObject({
        decision: "require_approval",
        ruleId: "require_approval_external_write"
      });

      const database = openRunsteadDatabase(compiled.stateDb);

      try {
        const event = database
          .prepare(
            `
            SELECT type, aggregate_type, aggregate_id, payload_json
            FROM events
            WHERE event_id = ?
          `
          )
          .get(compiled.event.eventId) as {
          type: string;
          aggregate_type: string;
          aggregate_id: string;
          payload_json: string;
        };

        expect(event).toMatchObject({
          type: "team_policy.compiled",
          aggregate_type: "team_policy",
          aggregate_id: "team_policy_repo_maintenance_v1"
        });
        expect(JSON.parse(event.payload_json)).toMatchObject({
          policyId: "team_policy_repo_maintenance_v1",
          rules: compiled.policy.rules.length
        });
      } finally {
        database.close();
      }
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});
