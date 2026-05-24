import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { Task } from "@runstead/core";
import { openRunsteadDatabase } from "@runstead/state-sqlite";
import { describe, expect, it } from "vitest";

import { decideApproval, showApproval } from "./approvals.js";
import { createGoal } from "./goals.js";
import {
  ToolActionApprovalRequiredError,
  ToolActionDeniedError
} from "./governed-action.js";
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

  it("reuses a task-scoped approval grant for safe scaffold writes", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-fs-scaffold-"));
    let fixture: FilesystemProxyFixture | undefined;

    try {
      fixture = await setupFilesystemProxyFixture(workspace);

      await expect(
        writeGovernedWorkspaceFile({
          ...fixture,
          path: "src/App.tsx",
          content: "export function App() { return null; }\n",
          createDirs: true,
          requestedBy: "test"
        })
      ).rejects.toBeInstanceOf(ToolActionApprovalRequiredError);

      const approval = fixture.database
        .prepare(
          `
          SELECT a.id, pd.action_json
          FROM approvals a
          JOIN policy_decisions pd ON pd.id = a.policy_decision_id
          WHERE a.action_id LIKE 'act_filesystem_write_%'
        `
        )
        .get() as { id: string; action_json: string } | undefined;

      if (approval === undefined) {
        throw new Error("Expected scaffold write approval");
      }

      const approvedAction = JSON.parse(approval.action_json) as {
        context?: {
          filesTouched?: string[];
          canonicalSignature?: string;
          approvalGrant?: { mode?: string; scope?: string };
        };
      };

      expect(approvedAction.context).toMatchObject({
        filesTouched: ["src/App.tsx"],
        approvalGrant: {
          mode: "scoped_until_expiry",
          scope: `safe_cwd_scaffold_write_v1:${fixture.task.id}`
        }
      });
      expect(approvedAction.context?.canonicalSignature).toMatch(/^[a-f0-9]{64}$/);

      await decideApproval({
        cwd: workspace,
        id: approval.id,
        decision: "approved",
        decidedBy: "local-admin",
        now: new Date("2026-05-15T00:02:00.000Z")
      });

      const firstWrite = await writeGovernedWorkspaceFile({
        ...fixture,
        path: "src/App.tsx",
        content: "export function App() { return null; }\n",
        createDirs: true,
        requestedBy: "test"
      });
      const secondWrite = await writeGovernedWorkspaceFile({
        ...fixture,
        path: "src/main.tsx",
        content: "import { App } from './App';\n",
        createDirs: true,
        requestedBy: "test"
      });

      expect(firstWrite.toolCall.output).toMatchObject({
        approvalId: approval.id,
        approvalGrant: "used",
        approvalGrantReuse: "scoped_until_expiry"
      });
      expect(secondWrite.toolCall.output).toMatchObject({
        approvalId: approval.id,
        approvalGrant: "used",
        approvalGrantMatch: "canonical_signature",
        approvalGrantReuse: "scoped_until_expiry"
      });
      expect(showApproval({ cwd: workspace, id: approval.id }).approval.status).toBe(
        "approved"
      );
    } finally {
      fixture?.database.close();
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("does not mint scaffold grants for dependency manifests", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-fs-scaffold-"));
    let fixture: FilesystemProxyFixture | undefined;

    try {
      fixture = await setupFilesystemProxyFixture(workspace);

      await expect(
        writeGovernedWorkspaceFile({
          ...fixture,
          path: "package.json",
          content: "{\"scripts\":{}}\n",
          requestedBy: "test"
        })
      ).rejects.toBeInstanceOf(ToolActionApprovalRequiredError);

      const row = fixture.database
        .prepare(
          `
          SELECT pd.action_json
          FROM approvals a
          JOIN policy_decisions pd ON pd.id = a.policy_decision_id
          WHERE a.action_id LIKE 'act_filesystem_write_%'
        `
        )
        .get() as { action_json: string } | undefined;

      if (row === undefined) {
        throw new Error("Expected package write approval");
      }

      const action = JSON.parse(row.action_json) as {
        context?: { canonicalSignature?: string; approvalGrant?: unknown };
      };

      expect(action.context?.canonicalSignature).toBeUndefined();
      expect(action.context?.approvalGrant).toBeUndefined();
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

  it("rejects symlink escapes before reading or writing files", async () => {
    const root = await mkdtemp(join(tmpdir(), "runstead-fs-proxy-"));
    const workspace = join(root, "workspace");
    let fixture: FilesystemProxyFixture | undefined;

    try {
      await mkdir(workspace);
      fixture = await setupFilesystemProxyFixture(workspace, {
        id: "policy_allow_workspace_io",
        version: 1,
        defaultDecision: "deny",
        defaultRisk: "critical",
        rules: [
          {
            id: "allow_workspace_io",
            when: {
              actionType: ["filesystem.read", "filesystem.write"]
            },
            decision: "allow",
            risk: "medium"
          }
        ]
      });
      const outside = join(root, "outside.txt");
      await writeFile(outside, "outside-secret\n", "utf8");
      await symlink(outside, join(workspace, "leak.txt"));

      await expect(
        readGovernedWorkspaceFile({
          ...fixture,
          path: "leak.txt",
          requestedBy: "test"
        })
      ).rejects.toThrow("Workspace path crosses symlink");
      await expect(
        writeGovernedWorkspaceFile({
          ...fixture,
          path: "leak.txt",
          content: "changed\n",
          requestedBy: "test"
        })
      ).rejects.toThrow("Workspace path crosses symlink");
      await expect(readFile(outside, "utf8")).resolves.toBe("outside-secret\n");
    } finally {
      fixture?.database.close();
      await rm(root, { force: true, recursive: true });
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
