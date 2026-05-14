import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openRunsteadDatabase } from "@runstead/state-sqlite";
import { describe, expect, it } from "vitest";

import { doctorRunstead } from "./doctor.js";
import { initRunstead } from "./init.js";

describe("doctorRunstead", () => {
  it("passes for an initialized workspace", async () => {
    const workspace = join(tmpdir(), `runstead-doctor-ok-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      await mkdir(workspace, { recursive: true });
      await initRunstead({ cwd: workspace });

      const result = await doctorRunstead({ cwd: workspace });

      expect(result.ok).toBe(true);
      expect(result.checks.map((check) => check.id)).toEqual(
        expect.arrayContaining([
          "config",
          "domain-pack",
          "domain-pack-validation",
          "policy",
          "policy-validation",
          "rbac-policy",
          "team-policy",
          "github-app-config",
          "daemon-dir",
          "daemon-heartbeat",
          "state-db"
        ])
      );
      expect(result.checks.every((check) => check.status === "pass")).toBe(true);
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("fails with concrete checks for an uninitialized workspace", async () => {
    const workspace = join(tmpdir(), `runstead-doctor-missing-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      await mkdir(workspace, { recursive: true });

      const result = await doctorRunstead({ cwd: workspace });

      expect(result.ok).toBe(false);
      expect(
        result.checks.filter((check) => check.status === "fail").length
      ).toBeGreaterThan(0);
      expect(result.checks.find((check) => check.id === "state-db")?.status).toBe(
        "fail"
      );
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("passes for a legacy .team workspace", async () => {
    const workspace = join(tmpdir(), `runstead-doctor-team-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      await mkdir(workspace, { recursive: true });
      await initRunstead({ cwd: workspace });
      await cp(join(workspace, ".runstead"), join(workspace, ".team"), {
        recursive: true
      });
      await rm(join(workspace, ".runstead"), { force: true, recursive: true });

      const result = await doctorRunstead({ cwd: workspace });

      expect(result.ok).toBe(true);
      expect(result.root).toBe(join(workspace, ".team"));
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("fails when the root policy is invalid", async () => {
    const workspace = join(tmpdir(), `runstead-doctor-policy-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      await mkdir(workspace, { recursive: true });
      await initRunstead({ cwd: workspace });
      await writeFile(
        join(workspace, ".runstead", "policies", "repo-maintenance.yaml"),
        "id: invalid\nversion: 1\nrules:\n  - id: missing_decision\n",
        "utf8"
      );

      const result = await doctorRunstead({ cwd: workspace });

      expect(result.ok).toBe(false);
      expect(
        result.checks.find((check) => check.id === "policy-validation")
      ).toMatchObject({
        status: "fail"
      });
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("fails when a governance projection table is missing", async () => {
    const workspace = join(tmpdir(), `runstead-doctor-state-schema-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      await mkdir(workspace, { recursive: true });
      const initialized = await initRunstead({ cwd: workspace });
      const database = openRunsteadDatabase(initialized.stateDb);

      try {
        database.exec("DROP TABLE tool_calls");
      } finally {
        database.close();
      }

      const result = await doctorRunstead({ cwd: workspace });

      expect(result.ok).toBe(false);
      expect(result.checks.find((check) => check.id === "state-db")).toMatchObject({
        status: "fail",
        message: "missing tables: tool_calls"
      });
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("fails when the daemon status directory is missing", async () => {
    const workspace = join(tmpdir(), `runstead-doctor-daemon-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      await mkdir(workspace, { recursive: true });
      await initRunstead({ cwd: workspace });
      await rm(join(workspace, ".runstead", "daemon"), {
        force: true,
        recursive: true
      });

      const result = await doctorRunstead({ cwd: workspace });

      expect(result.ok).toBe(false);
      expect(result.checks.find((check) => check.id === "daemon-dir")).toMatchObject({
        status: "fail"
      });
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("fails when the daemon heartbeat file is invalid", async () => {
    const workspace = join(tmpdir(), `runstead-doctor-daemon-heartbeat-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      await mkdir(workspace, { recursive: true });
      await initRunstead({ cwd: workspace });
      await writeFile(
        join(workspace, ".runstead", "daemon", "status.json"),
        JSON.stringify({ tick: 1 }),
        "utf8"
      );

      const result = await doctorRunstead({ cwd: workspace });

      expect(result.ok).toBe(false);
      expect(
        result.checks.find((check) => check.id === "daemon-heartbeat")
      ).toMatchObject({
        status: "fail",
        message: "status is missing required fields"
      });
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("fails when RBAC policy is invalid", async () => {
    const workspace = join(tmpdir(), `runstead-doctor-rbac-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      await mkdir(workspace, { recursive: true });
      await initRunstead({ cwd: workspace });
      await writeFile(
        join(workspace, ".runstead", "rbac.yaml"),
        "version: 2\nroles: []\nsubjects: []\n",
        "utf8"
      );

      const result = await doctorRunstead({ cwd: workspace });

      expect(result.ok).toBe(false);
      expect(result.checks.find((check) => check.id === "rbac-policy")).toMatchObject({
        status: "fail"
      });
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("fails when GitHub App config points at an unreadable private key", async () => {
    const workspace = join(tmpdir(), `runstead-doctor-github-app-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      await mkdir(workspace, { recursive: true });
      await initRunstead({ cwd: workspace });
      await writeFile(
        join(workspace, ".runstead", "github-app.yaml"),
        "app_id: 123\nprivate_key_path: missing-key.pem\n",
        "utf8"
      );

      const result = await doctorRunstead({ cwd: workspace });

      expect(result.ok).toBe(false);
      expect(
        result.checks.find((check) => check.id === "github-app-config")
      ).toMatchObject({
        status: "fail"
      });
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});
