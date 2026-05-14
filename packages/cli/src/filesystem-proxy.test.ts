import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { Task } from "@runstead/core";
import { openRunsteadDatabase } from "@runstead/state-sqlite";
import { describe, expect, it } from "vitest";

import { createGoal } from "./goals.js";
import { ToolActionDeniedError } from "./governed-action.js";
import { initRunstead } from "./init.js";
import { loadPolicyProfileFromFile } from "./policy-loader.js";
import {
  readGovernedWorkspaceFile,
  writeGovernedWorkspaceFile
} from "./filesystem-proxy.js";
import type { PolicyProfile } from "./policy.js";
import { startWorkerRun } from "./runtime-audit.js";

const policyPath = fileURLToPath(
  new URL(
    "../../domain-packs/packs/repo-maintenance/policies/repo-maintenance.yaml",
    import.meta.url
  )
);

describe("filesystem proxy", () => {
  it("reads workspace files through policy and tool call audit", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-fs-proxy-"));
    let fixture: FilesystemProxyFixture | undefined;

    try {
      fixture = await setupFilesystemProxyFixture(workspace);
      await writeFile(join(workspace, "README.md"), "# Fixture\n", "utf8");

      const result = await readGovernedWorkspaceFile({
        ...fixture,
        path: "README.md",
        requestedBy: "test"
      });

      expect(result.value).toEqual({
        path: "README.md",
        content: "# Fixture\n",
        bytes: 10
      });
      expect(result.toolCall).toMatchObject({
        actionType: "filesystem.read",
        status: "completed",
        policyDecisionId: result.policyDecision.id
      });
      expect(result.policyDecision).toMatchObject({
        decision: "allow",
        ruleId: "allow_read_workspace"
      });
    } finally {
      fixture?.database.close();
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("denies protected workspace writes before touching files", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-fs-proxy-"));
    let fixture: FilesystemProxyFixture | undefined;

    try {
      fixture = await setupFilesystemProxyFixture(workspace);
      await writeFile(join(workspace, ".env"), "before", "utf8");

      await expect(
        writeGovernedWorkspaceFile({
          ...fixture,
          path: ".env",
          content: "after",
          requestedBy: "test"
        })
      ).rejects.toBeInstanceOf(ToolActionDeniedError);

      await expect(readFile(join(workspace, ".env"), "utf8")).resolves.toBe("before");
      const denied = fixture.database
        .prepare(
          `
          SELECT status, policy_decision_id
          FROM tool_calls
          WHERE action_type = 'filesystem.write'
        `
        )
        .get() as { status: string; policy_decision_id: string };

      expect(denied.status).toBe("denied");
      expect(denied.policy_decision_id).toMatch(/^poldec_/);
    } finally {
      fixture?.database.close();
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("writes allowed workspace files through policy and audit", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-fs-proxy-"));
    let fixture: FilesystemProxyFixture | undefined;

    try {
      fixture = await setupFilesystemProxyFixture(workspace, {
        id: "policy_allow_src_write",
        version: 1,
        defaultDecision: "deny",
        defaultRisk: "critical",
        rules: [
          {
            id: "allow_src_write",
            when: {
              actionType: "filesystem.write",
              path: {
                matchesAny: ["src/**"]
              }
            },
            decision: "allow",
            risk: "medium"
          }
        ]
      });

      const result = await writeGovernedWorkspaceFile({
        ...fixture,
        path: "src/fix.ts",
        content: "export const fixed = true;\n",
        createDirs: true,
        requestedBy: "test"
      });

      expect(result.value).toEqual({
        path: "src/fix.ts",
        bytes: 27
      });
      await expect(readFile(join(workspace, "src", "fix.ts"), "utf8")).resolves.toBe(
        "export const fixed = true;\n"
      );
      expect(result.toolCall).toMatchObject({
        actionType: "filesystem.write",
        status: "completed",
        policyDecisionId: result.policyDecision.id
      });
      expect(result.policyDecision).toMatchObject({
        decision: "allow",
        ruleId: "allow_src_write"
      });
    } finally {
      fixture?.database.close();
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("rejects paths that escape the workspace root", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-fs-proxy-"));
    let fixture: FilesystemProxyFixture | undefined;

    try {
      fixture = await setupFilesystemProxyFixture(workspace);

      await expect(
        readGovernedWorkspaceFile({
          ...fixture,
          path: "../outside.txt",
          requestedBy: "test"
        })
      ).rejects.toThrow("Workspace path escapes root");
    } finally {
      fixture?.database.close();
      await rm(workspace, { force: true, recursive: true });
    }
  });
});

interface FilesystemProxyFixture {
  cwd: string;
  stateDb: string;
  database: ReturnType<typeof openRunsteadDatabase>;
  policy: PolicyProfile;
  task: Task;
  workerRun: ReturnType<typeof startWorkerRun>;
}

async function setupFilesystemProxyFixture(
  workspace: string,
  policy?: PolicyProfile
): Promise<FilesystemProxyFixture> {
  await mkdir(workspace, { recursive: true });
  const initialized = await initRunstead({ cwd: workspace });
  const goal = await createGoal({
    cwd: workspace,
    domain: "repo-maintenance",
    now: new Date("2026-05-15T00:00:00.000Z")
  });
  const task = goal.generatedTasks[0];

  if (task === undefined) {
    throw new Error("Expected default goal to create a task");
  }

  const database = openRunsteadDatabase(initialized.stateDb);
  const workerRun = startWorkerRun({
    database,
    task,
    workerType: "filesystem_proxy_test",
    enforcementLevel: "policy_enforced",
    now: new Date("2026-05-15T00:01:00.000Z")
  });

  return {
    cwd: workspace,
    stateDb: initialized.stateDb,
    database,
    policy: policy ?? (await loadPolicyProfileFromFile(policyPath)),
    task,
    workerRun
  };
}
