import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { openRunsteadDatabase } from "@runstead/state-sqlite";
import { describe, expect, it } from "vitest";

import { doctorRunstead } from "./doctor.js";
import { initRunstead } from "./init.js";
import { setRunsteadConfigValue } from "./config.js";

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
          "node-runtime",
          "domain-pack",
          "domain-pack-validation",
          "domain-pack-manifests",
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
      expect(
        result.checks.find((check) => check.id === "node-runtime")?.message
      ).toContain("package engines >=24.15 <27");
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

  it("fails when an installed domain pack manifest drifts", async () => {
    const workspace = join(tmpdir(), `runstead-doctor-domain-manifest-${process.pid}`);
    const domainPath = join(
      workspace,
      ".runstead",
      "domains",
      "repo-maintenance",
      "domain.yaml"
    );

    try {
      await rm(workspace, { force: true, recursive: true });
      await mkdir(workspace, { recursive: true });
      await initRunstead({ cwd: workspace });
      await writeFile(
        domainPath,
        `${await readFile(domainPath, "utf8")}\n# local drift\n`,
        "utf8"
      );

      const result = await doctorRunstead({ cwd: workspace });

      expect(result.ok).toBe(false);
      expect(
        result.checks.find((check) => check.id === "domain-pack-manifests")
      ).toMatchObject({
        status: "fail"
      });
      expect(
        result.checks.find((check) => check.id === "domain-pack-manifests")?.message
      ).toContain("manifest_file_hash_mismatch");
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

  it("fails when state migrations are stale", async () => {
    const workspace = join(tmpdir(), `runstead-doctor-state-version-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      await mkdir(workspace, { recursive: true });
      const initialized = await initRunstead({ cwd: workspace });
      const database = new DatabaseSync(initialized.stateDb);

      try {
        database.exec("DELETE FROM schema_migrations WHERE version = 2");
        database.exec("PRAGMA user_version = 1");
      } finally {
        database.close();
      }

      const result = await doctorRunstead({ cwd: workspace });

      expect(result.ok).toBe(false);
      expect(result.checks.find((check) => check.id === "state-db")).toMatchObject({
        status: "fail"
      });
      expect(result.checks.find((check) => check.id === "state-db")?.message).toContain(
        "missing migrations: 2"
      );
      expect(result.checks.find((check) => check.id === "state-db")?.message).toContain(
        "sqlite user_version 1, expected 2"
      );
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

  it("adds Codex Direct readiness checks for trusted local workspaces", async () => {
    const workspace = join(tmpdir(), `runstead-doctor-codex-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      await mkdir(workspace, { recursive: true });
      await initRunstead({ cwd: workspace, profile: "trusted-local" });

      const result = await doctorRunstead({
        cwd: workspace,
        codex: true,
        modelProviderEnv: {},
        codexAuthStatus: () =>
          Promise.resolve({
            loggedIn: true,
            accessTokenExpired: false,
            authPath: "/tmp/runstead-auth.json"
          }),
        codexModelResolver: () =>
          Promise.resolve({
            model: "configured-codex",
            source: "config"
          })
      });

      expect(result.ok).toBe(true);
      expect(result.checks.map((check) => check.id)).toEqual(
        expect.arrayContaining([
          "runstead-initialized",
          "trusted-local-policy",
          "codex-direct-policy",
          "model-provider",
          "codex-auth",
          "codex-default-model",
          "runtime-artifacts-ignore"
        ])
      );
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("checks codex_cli readiness without requiring Runstead Codex Direct login", async () => {
    const workspace = join(tmpdir(), `runstead-doctor-codex-cli-${process.pid}`);
    const calls: { command: string; args: string[] }[] = [];

    try {
      await rm(workspace, { force: true, recursive: true });
      await mkdir(workspace, { recursive: true });
      await initRunstead({ cwd: workspace, profile: "trusted-local" });

      const result = await doctorRunstead({
        cwd: workspace,
        codex: true,
        worker: "codex_cli",
        model: "gpt-5.5",
        codexAuthStatus: () => {
          throw new Error("Runstead Codex Direct auth should not be checked");
        },
        codexCliProbeRunner(command, args) {
          calls.push({ command, args });

          if (args[0] === "--version") {
            return Promise.resolve({
              stdout: "codex-cli 0.130.0\n",
              stderr: "",
              exitCode: 0
            });
          }

          return Promise.resolve({
            stdout: '{"runstead_codex_cli_probe":true}\n',
            stderr: "",
            exitCode: 0
          });
        }
      });

      expect(result.ok).toBe(true);
      expect(result.checks.map((check) => check.id)).toEqual(
        expect.arrayContaining([
          "codex-cli-policy",
          "codex-cli-binary",
          "codex-cli-exec",
          "runtime-artifacts-ignore"
        ])
      );
      expect(result.checks.map((check) => check.id)).not.toContain("codex-auth");
      expect(result.checks.map((check) => check.id)).not.toContain(
        "codex-default-model"
      );
      expect(calls[1]?.args).toEqual([
        "exec",
        "--model",
        "gpt-5.5",
        "--sandbox",
        "workspace-write",
        "--cd",
        workspace,
        expect.stringContaining("runstead_codex_cli_probe")
      ]);
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("diagnoses Codex CLI auth failures as local CLI profile problems", async () => {
    const workspace = join(tmpdir(), `runstead-doctor-codex-cli-auth-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      await mkdir(workspace, { recursive: true });
      await initRunstead({ cwd: workspace, profile: "trusted-local" });

      const result = await doctorRunstead({
        cwd: workspace,
        codex: true,
        worker: "codex_cli",
        codexCliProbeRunner(_command, args) {
          if (args[0] === "--version") {
            return Promise.resolve({
              stdout: "codex-cli 0.130.0\n",
              stderr: "",
              exitCode: 0
            });
          }

          return Promise.resolve({
            stdout: "",
            stderr: 'AuthRequired: Bearer error="invalid_token" not authorized',
            exitCode: 1
          });
        }
      });
      const execCheck = result.checks.find((check) => check.id === "codex-cli-exec");

      expect(result.ok).toBe(false);
      expect(execCheck).toMatchObject({
        status: "fail"
      });
      expect(execCheck?.message).toContain("local CLI/MCP auth problem");
      expect(execCheck?.message).toContain("separate from Runstead Codex Direct login");
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("checks claude_code readiness without requiring Runstead Codex Direct login", async () => {
    const workspace = join(tmpdir(), `runstead-doctor-claude-code-${process.pid}`);
    const calls: { command: string; args: string[] }[] = [];

    try {
      await rm(workspace, { force: true, recursive: true });
      await mkdir(workspace, { recursive: true });
      await initRunstead({ cwd: workspace, profile: "trusted-local" });

      const result = await doctorRunstead({
        cwd: workspace,
        codex: true,
        worker: "claude_code",
        model: "sonnet",
        codexAuthStatus: () => {
          throw new Error("Runstead Codex Direct auth should not be checked");
        },
        wrappedWorkerProbeRunner(command, args) {
          calls.push({ command, args });

          if (args[0] === "--version") {
            return Promise.resolve({
              stdout: "1.0.0 (Claude Code)\n",
              stderr: "",
              exitCode: 0
            });
          }

          return Promise.resolve({
            stdout: '{"runstead_claude_code_probe":true}\n',
            stderr: "",
            exitCode: 0
          });
        }
      });

      expect(result.ok).toBe(true);
      expect(result.checks.map((check) => check.id)).toEqual(
        expect.arrayContaining([
          "claude-code-policy",
          "claude-code-binary",
          "claude-code-print",
          "runtime-artifacts-ignore"
        ])
      );
      expect(result.checks.map((check) => check.id)).not.toContain("codex-auth");
      expect(result.checks.map((check) => check.id)).not.toContain(
        "codex-default-model"
      );
      expect(calls[1]?.command).toBe("claude");
      expect(calls[1]?.args).toEqual([
        "-p",
        "--model",
        "sonnet",
        "--output-format",
        "json",
        "--json-schema",
        expect.stringContaining('"summary"'),
        "--permission-mode",
        "default",
        "--disallowedTools",
        expect.stringContaining("Bash(git push *)"),
        "--",
        expect.stringContaining("runstead_claude_code_probe")
      ]);
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("diagnoses Claude Code CLI auth failures as local Claude profile problems", async () => {
    const workspace = join(tmpdir(), `runstead-doctor-claude-code-auth-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      await mkdir(workspace, { recursive: true });
      await initRunstead({ cwd: workspace, profile: "trusted-local" });

      const result = await doctorRunstead({
        cwd: workspace,
        codex: true,
        worker: "claude_code",
        wrappedWorkerProbeRunner(_command, args) {
          if (args[0] === "--version") {
            return Promise.resolve({
              stdout: "1.0.0 (Claude Code)\n",
              stderr: "",
              exitCode: 0
            });
          }

          return Promise.resolve({
            stdout: "",
            stderr: "Please login to Claude Code before using the subscription",
            exitCode: 1
          });
        }
      });
      const printCheck = result.checks.find(
        (check) => check.id === "claude-code-print"
      );

      expect(result.ok).toBe(false);
      expect(printCheck).toMatchObject({
        status: "fail"
      });
      expect(printCheck?.message).toContain("local Claude auth/profile problem");
      expect(printCheck?.message).toContain(
        "separate from Runstead Codex Direct login"
      );
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("checks configured non-Codex model provider readiness without Codex login", async () => {
    const workspace = join(tmpdir(), `runstead-doctor-provider-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      await mkdir(workspace, { recursive: true });
      await initRunstead({ cwd: workspace, profile: "trusted-local" });
      await setRunsteadConfigValue({
        cwd: workspace,
        key: "model.provider",
        value: "openrouter"
      });
      await setRunsteadConfigValue({
        cwd: workspace,
        key: "model.name",
        value: "anthropic/claude-opus-4.6"
      });

      const result = await doctorRunstead({
        cwd: workspace,
        codex: true,
        modelProviderEnv: {
          OPENROUTER_API_KEY: "token"
        },
        codexAuthStatus: () => {
          throw new Error("Codex auth should not be checked for OpenRouter");
        }
      });

      expect(result.ok).toBe(true);
      expect(result.checks.map((check) => check.id)).toEqual(
        expect.arrayContaining([
          "trusted-local-policy",
          "model-provider",
          "model-provider-auth"
        ])
      );
      expect(result.checks.map((check) => check.id)).not.toContain("codex-auth");
      const providerCheck = result.checks.find(
        (check) => check.id === "model-provider"
      );
      expect(providerCheck?.status).toBe("pass");
      expect(providerCheck?.message).toContain("provider=openrouter");
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("reports missing non-Codex provider credentials", async () => {
    const workspace = join(tmpdir(), `runstead-doctor-provider-auth-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      await mkdir(workspace, { recursive: true });
      await initRunstead({ cwd: workspace, profile: "trusted-local" });
      await setRunsteadConfigValue({
        cwd: workspace,
        key: "model.provider",
        value: "anthropic"
      });
      await setRunsteadConfigValue({
        cwd: workspace,
        key: "model.name",
        value: "claude-opus-4.6"
      });

      const result = await doctorRunstead({
        cwd: workspace,
        codex: true,
        modelProviderEnv: {}
      });

      expect(result.ok).toBe(false);
      const authCheck = result.checks.find(
        (check) => check.id === "model-provider-auth"
      );
      expect(authCheck?.status).toBe("fail");
      expect(authCheck?.message).toContain("ANTHROPIC_API_KEY");
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("fails Codex readiness when the policy is not trusted local", async () => {
    const workspace = join(tmpdir(), `runstead-doctor-codex-policy-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      await mkdir(workspace, { recursive: true });
      await initRunstead({ cwd: workspace });

      const result = await doctorRunstead({
        cwd: workspace,
        codex: true,
        modelProviderEnv: {},
        codexAuthStatus: () =>
          Promise.resolve({
            loggedIn: true,
            accessTokenExpired: false,
            authPath: "/tmp/runstead-auth.json"
          }),
        codexModelResolver: () =>
          Promise.resolve({
            model: "configured-codex",
            source: "config"
          })
      });

      expect(result.ok).toBe(false);
      expect(
        result.checks.find((check) => check.id === "trusted-local-policy")
      ).toMatchObject({
        status: "fail"
      });
      expect(
        result.checks.find((check) => check.id === "codex-direct-policy")
      ).toMatchObject({
        status: "fail"
      });
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});
