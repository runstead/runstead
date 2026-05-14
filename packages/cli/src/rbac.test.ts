import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openRunsteadDatabase } from "@runstead/state-sqlite";
import { describe, expect, it } from "vitest";

import { checkPermission, grantRole, initRbac } from "./rbac.js";

describe("rbac", () => {
  it("initializes, checks, and grants local roles", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-rbac-"));
    const root = join(workspace, ".runstead");

    try {
      await mkdir(root, { recursive: true });
      await writeFile(
        join(root, "config.yaml"),
        "version: 1\ndomain: repo-maintenance\n",
        "utf8"
      );
      openRunsteadDatabase(join(root, "state.db")).close();

      const initialized = await initRbac({
        cwd: workspace,
        subject: "local-admin",
        role: "admin"
      });
      await grantRole({
        cwd: workspace,
        actor: "local-admin",
        subject: "alice",
        role: "operator",
        now: new Date("2026-05-14T06:55:00.000Z")
      });
      const allowed = await checkPermission({
        cwd: workspace,
        subject: "alice",
        permission: "task.run"
      });
      const denied = await checkPermission({
        cwd: workspace,
        subject: "alice",
        permission: "approval.decide"
      });
      const granted = await grantRole({
        cwd: workspace,
        actor: "local-admin",
        subject: "bob",
        role: "approver",
        now: new Date("2026-05-14T07:00:00.000Z")
      });
      await expect(
        grantRole({
          cwd: workspace,
          actor: "alice",
          subject: "mallory",
          role: "approver",
          now: new Date("2026-05-14T07:01:00.000Z")
        })
      ).rejects.toThrow("Subject alice cannot manage RBAC");
      const bob = await checkPermission({
        cwd: workspace,
        subject: "bob",
        permission: "approval.decide"
      });
      const webhook = await checkPermission({
        cwd: workspace,
        subject: "alice",
        permission: "webhook.manage"
      });
      const teamPolicy = await checkPermission({
        cwd: workspace,
        subject: "alice",
        permission: "team_policy.manage"
      });
      const githubApp = await checkPermission({
        cwd: workspace,
        subject: "alice",
        permission: "github_app.manage"
      });
      const domainManage = await checkPermission({
        cwd: workspace,
        subject: "alice",
        permission: "domain.manage"
      });
      const domainRead = await checkPermission({
        cwd: workspace,
        subject: "bob",
        permission: "domain.read"
      });
      const dashboardManage = await checkPermission({
        cwd: workspace,
        subject: "alice",
        permission: "dashboard.manage"
      });
      const dashboardWriteDenied = await checkPermission({
        cwd: workspace,
        subject: "bob",
        permission: "dashboard.manage"
      });
      const rbacYaml = await readFile(initialized.path, "utf8");

      expect(initialized.overwritten).toBe(false);
      expect(allowed).toMatchObject({
        decision: "allow",
        roles: ["operator"]
      });
      expect(denied).toMatchObject({
        decision: "deny",
        roles: ["operator"]
      });
      expect(bob).toMatchObject({
        decision: "allow",
        roles: ["approver"]
      });
      expect(webhook).toMatchObject({
        decision: "allow",
        roles: ["operator"]
      });
      expect(teamPolicy).toMatchObject({
        decision: "allow",
        roles: ["operator"]
      });
      expect(githubApp).toMatchObject({
        decision: "allow",
        roles: ["operator"]
      });
      expect(domainManage).toMatchObject({
        decision: "allow",
        roles: ["operator"]
      });
      expect(domainRead).toMatchObject({
        decision: "allow",
        roles: ["approver"]
      });
      expect(dashboardManage).toMatchObject({
        decision: "allow",
        roles: ["operator"]
      });
      expect(dashboardWriteDenied).toMatchObject({
        decision: "deny",
        roles: ["approver"]
      });
      expect(rbacYaml).toContain("bob");

      const database = openRunsteadDatabase(granted.stateDb);

      try {
        const event = database
          .prepare(
            `
            SELECT type, aggregate_type, aggregate_id, payload_json
            FROM events
            WHERE event_id = ?
          `
          )
          .get(granted.event.eventId) as {
          type: string;
          aggregate_type: string;
          aggregate_id: string;
          payload_json: string;
        };

        expect(event).toMatchObject({
          type: "rbac.role_granted",
          aggregate_type: "rbac_subject",
          aggregate_id: "bob"
        });
        expect(JSON.parse(event.payload_json)).toEqual({
          subject: "bob",
          role: "approver",
          grantedBy: "local-admin"
        });
      } finally {
        database.close();
      }
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("supports narrow operational permissions without daemon management", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-rbac-narrow-"));
    const root = join(workspace, ".runstead");

    try {
      await mkdir(root, { recursive: true });
      await writeFile(
        join(root, "config.yaml"),
        "version: 1\ndomain: repo-maintenance\n",
        "utf8"
      );
      await writeFile(
        join(root, "rbac.yaml"),
        [
          "version: 1",
          "roles:",
          "  webhooker:",
          "    - webhook.manage",
          "subjects:",
          "  webhook-bot:",
          "    roles:",
          "      - webhooker"
        ].join("\n"),
        "utf8"
      );

      const webhook = await checkPermission({
        cwd: workspace,
        subject: "webhook-bot",
        permission: "webhook.manage"
      });
      const daemon = await checkPermission({
        cwd: workspace,
        subject: "webhook-bot",
        permission: "daemon.manage"
      });
      const teamPolicy = await checkPermission({
        cwd: workspace,
        subject: "webhook-bot",
        permission: "team_policy.manage"
      });

      expect(webhook).toMatchObject({
        decision: "allow",
        roles: ["webhooker"]
      });
      expect(daemon).toMatchObject({
        decision: "deny",
        roles: ["webhooker"]
      });
      expect(teamPolicy).toMatchObject({
        decision: "deny",
        roles: ["webhooker"]
      });
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});
