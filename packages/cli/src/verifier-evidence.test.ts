import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";

import type { Task } from "@runstead/core";
import { openRunsteadDatabase } from "@runstead/state-sqlite";
import { describe, expect, it } from "vitest";

import {
  storeCommandVerifierEvidence,
  storeCommandVerifierPolicyEvidence
} from "./verifier-evidence.js";

const execFileAsync = promisify(execFile);

describe("storeCommandVerifierEvidence", () => {
  it("stores command output evidence and appends an event", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-verifier-"));
    const runsteadRoot = join(workspace, ".runstead");
    const database = openRunsteadDatabase(join(runsteadRoot, "state.db"));
    const task: Task = {
      id: "task_verifier_evidence_001",
      goalId: "goal_verifier_evidence_001",
      domain: "repo-maintenance",
      type: "run_local_verifiers",
      status: "running",
      priority: "medium",
      attempt: 0,
      maxAttempts: 1,
      input: {},
      verifiers: ["command:test"],
      createdAt: "2026-05-14T05:00:00.000Z",
      updatedAt: "2026-05-14T05:00:00.000Z"
    };

    try {
      const result = await storeCommandVerifierEvidence({
        cwd: workspace,
        runsteadRoot,
        database,
        task,
        command: {
          name: "test",
          command: nodeCommand("console.log('verifier ok');")
        },
        now: new Date("2026-05-14T05:01:00.000Z")
      });
      const artifact = JSON.parse(await readFile(result.artifactPath, "utf8")) as {
        taskId: string;
        verifier: string;
        codeState: { available: boolean; fingerprint: string };
        result: { exitCode: number; stdout: string };
      };
      const evidence = database
        .prepare(
          `
          SELECT id, type, subject_type, subject_id, uri, hash, summary,
                 created_at
          FROM evidence
        `
        )
        .get() as {
        id: string;
        type: string;
        subject_type: string;
        subject_id: string;
        uri: string;
        hash: string;
        summary: string;
        created_at: string;
      };
      const event = database
        .prepare(
          `
          SELECT type, aggregate_type, aggregate_id, payload_json
          FROM events
        `
        )
        .get() as {
        type: string;
        aggregate_type: string;
        aggregate_id: string;
        payload_json: string;
      };

      expect(artifact).toMatchObject({
        taskId: task.id,
        verifier: "test",
        codeState: {
          available: false
        },
        result: {
          exitCode: 0,
          stdout: "verifier ok\n"
        }
      });
      expect(evidence).toMatchObject({
        id: result.evidence.id,
        type: "command_output",
        subject_type: "task",
        subject_id: task.id,
        uri: result.evidence.uri,
        hash: result.evidence.hash,
        summary: "test: passed",
        created_at: "2026-05-14T05:01:00.000Z"
      });
      expect(event).toMatchObject({
        type: "evidence.recorded",
        aggregate_type: "evidence",
        aggregate_id: result.evidence.id
      });
      expect(JSON.parse(event.payload_json)).toMatchObject({
        taskId: task.id,
        verifier: "test",
        exitCode: 0,
        timedOut: false
      });
      expect(artifact.codeState.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    } finally {
      database.close();
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("binds command evidence to the current git workspace state", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-verifier-git-"));
    const runsteadRoot = join(workspace, ".runstead");
    const database = openRunsteadDatabase(join(runsteadRoot, "state.db"));
    const task = verifierTask();

    try {
      await git(workspace, "init");
      await git(workspace, "config", "user.email", "runstead@example.com");
      await git(workspace, "config", "user.name", "Runstead Test");
      await writeFile(join(workspace, "tracked.js"), "console.log('old');\n", "utf8");
      await git(workspace, "add", "tracked.js");
      await git(workspace, "commit", "-m", "initial");
      await writeFile(join(workspace, "tracked.js"), "console.log('new');\n", "utf8");

      const result = await storeCommandVerifierEvidence({
        cwd: workspace,
        runsteadRoot,
        database,
        task,
        command: {
          name: "test",
          command: nodeCommand("process.exit(0);")
        },
        now: new Date("2026-05-14T05:04:00.000Z")
      });
      const artifact = JSON.parse(await readFile(result.artifactPath, "utf8")) as {
        codeState: {
          available: boolean;
          dirty: boolean;
          gitHead?: string;
          statusHash: string;
          fileSetHash: string;
          fingerprint: string;
          changedFiles: { path: string; status: string; hash?: string }[];
        };
      };

      expect(artifact.codeState).toMatchObject({
        available: true,
        dirty: true
      });
      expect(artifact.codeState.gitHead).toMatch(/^[a-f0-9]{40}$/);
      expect(artifact.codeState.statusHash).toMatch(/^[a-f0-9]{64}$/);
      expect(artifact.codeState.fileSetHash).toMatch(/^[a-f0-9]{64}$/);
      expect(artifact.codeState.fingerprint).toMatch(/^[a-f0-9]{64}$/);
      expect(artifact.codeState.changedFiles).toEqual([
        {
          path: "tracked.js",
          status: " M",
          hash: artifact.codeState.changedFiles[0]?.hash
        }
      ]);
      expect(artifact.codeState.changedFiles[0]?.hash).toMatch(/^[a-f0-9]{64}$/);
    } finally {
      database.close();
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("sanitizes verifier names before using them in artifact filenames", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-verifier-"));
    const runsteadRoot = join(workspace, ".runstead");
    const database = openRunsteadDatabase(join(runsteadRoot, "state.db"));
    const task = verifierTask();

    try {
      const command = {
        name: "../../evil/test:lint",
        command: nodeCommand("process.exit(0);")
      };
      const commandEvidence = await storeCommandVerifierEvidence({
        cwd: workspace,
        runsteadRoot,
        database,
        task,
        command,
        now: new Date("2026-05-14T05:02:00.000Z")
      });
      const policyEvidence = await storeCommandVerifierPolicyEvidence({
        cwd: workspace,
        runsteadRoot,
        database,
        task,
        command,
        policyDecisionId: "poldec_unsafe_name",
        decision: "require_approval",
        reason: "No policy rule matched",
        now: new Date("2026-05-14T05:03:00.000Z")
      });
      const artifact = JSON.parse(
        await readFile(commandEvidence.artifactPath, "utf8")
      ) as { verifier: string };

      expect(basename(commandEvidence.artifactPath)).toMatch(
        /^verifier-\.\._\.\._evil_test_lint-ev_/
      );
      expect(basename(policyEvidence.artifactPath)).toMatch(
        /^verifier-\.\._\.\._evil_test_lint-require_approval-ev_/
      );
      expect(artifact.verifier).toBe(command.name);
    } finally {
      database.close();
      await rm(workspace, { force: true, recursive: true });
    }
  });
});

async function git(workspace: string, ...args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd: workspace });
}

function nodeCommand(script: string): string {
  return `${JSON.stringify(process.execPath)} -e ${JSON.stringify(script)}`;
}

function verifierTask(): Task {
  return {
    id: "task_verifier_evidence_001",
    goalId: "goal_verifier_evidence_001",
    domain: "repo-maintenance",
    type: "run_local_verifiers",
    status: "running",
    priority: "medium",
    attempt: 0,
    maxAttempts: 1,
    input: {},
    verifiers: ["command:test"],
    createdAt: "2026-05-14T05:00:00.000Z",
    updatedAt: "2026-05-14T05:00:00.000Z"
  };
}
