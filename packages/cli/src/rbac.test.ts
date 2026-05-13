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

      const initialized = await initRbac({
        cwd: workspace,
        subject: "alice",
        role: "operator"
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
        subject: "bob",
        role: "approver",
        now: new Date("2026-05-14T07:00:00.000Z")
      });
      const bob = await checkPermission({
        cwd: workspace,
        subject: "bob",
        permission: "approval.decide"
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
          role: "approver"
        });
      } finally {
        database.close();
      }
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});
