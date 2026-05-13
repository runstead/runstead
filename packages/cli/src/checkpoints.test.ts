import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createWorkspaceCheckpoint,
  restoreWorkspaceCheckpoint,
  type GitCheckpointRunner
} from "./checkpoints.js";

describe("createWorkspaceCheckpoint", () => {
  it("captures tracked diff metadata and untracked file snapshots", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-checkpoint-"));
    const checkpointDir = join(workspace, ".runstead", "checkpoints");
    const calls: string[][] = [];
    const runner: GitCheckpointRunner = (args) => {
      calls.push(args);

      switch (args.join(" ")) {
        case "rev-parse HEAD":
          return Promise.resolve({ stdout: "abc123\n", stderr: "", exitCode: 0 });
        case "status --short":
          return Promise.resolve({ stdout: "?? notes.txt\n", stderr: "", exitCode: 0 });
        case "diff --binary HEAD":
          return Promise.resolve({ stdout: "diff --git a/a b/a\n", stderr: "", exitCode: 0 });
        case "ls-files --others --exclude-standard -z":
          return Promise.resolve({
            stdout: "notes.txt\0nested/log.txt\0../ignored.txt\0",
            stderr: "",
            exitCode: 0
          });
        default:
          return Promise.resolve({ stdout: "", stderr: "unexpected", exitCode: 1 });
      }
    };

    try {
      await mkdir(join(workspace, "nested"), { recursive: true });
      await writeFile(join(workspace, "notes.txt"), "before", "utf8");
      await writeFile(join(workspace, "nested", "log.txt"), "log", "utf8");

      const checkpoint = await createWorkspaceCheckpoint({
        workspace,
        checkpointDir,
        runner,
        now: new Date("2026-05-14T00:00:00.000Z")
      });

      expect(checkpoint).toMatchObject({
        workspace,
        checkpointDir,
        head: "abc123",
        untrackedFiles: ["notes.txt", "nested/log.txt"]
      });
      await expect(readFile(join(checkpoint.untrackedDir, "notes.txt"), "utf8"))
        .resolves.toBe("before");
      await expect(readFile(join(checkpoint.untrackedDir, "nested", "log.txt"), "utf8"))
        .resolves.toBe("log");
      expect(calls).toContainEqual(["ls-files", "--others", "--exclude-standard", "-z"]);
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});

describe("restoreWorkspaceCheckpoint", () => {
  it("restores checkpoint snapshots while preserving Runstead state files", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-rollback-"));
    const checkpointDir = join(workspace, ".runstead", "checkpoints");
    const createRunner: GitCheckpointRunner = (args) => {
      switch (args.join(" ")) {
        case "rev-parse HEAD":
          return Promise.resolve({ stdout: "abc123\n", stderr: "", exitCode: 0 });
        case "status --short":
          return Promise.resolve({ stdout: "?? notes.txt\n", stderr: "", exitCode: 0 });
        case "diff --binary HEAD":
          return Promise.resolve({ stdout: "diff --git a/a b/a\n", stderr: "", exitCode: 0 });
        case "ls-files --others --exclude-standard -z":
          return Promise.resolve({ stdout: "notes.txt\0", stderr: "", exitCode: 0 });
        default:
          return Promise.resolve({ stdout: "", stderr: "unexpected", exitCode: 1 });
      }
    };
    const restoreCalls: string[][] = [];
    const restoreRunner: GitCheckpointRunner = (args) => {
      restoreCalls.push(args);

      switch (args[0]) {
        case "rev-parse":
          return Promise.resolve({ stdout: "abc123\n", stderr: "", exitCode: 0 });
        case "reset":
          return Promise.resolve({ stdout: "reset", stderr: "", exitCode: 0 });
        case "ls-files":
          return Promise.resolve({
            stdout: "notes.txt\0new.txt\0.runstead/state.db\0",
            stderr: "",
            exitCode: 0
          });
        case "apply":
          return Promise.resolve({ stdout: "applied", stderr: "", exitCode: 0 });
        default:
          return Promise.resolve({ stdout: "", stderr: "unexpected", exitCode: 1 });
      }
    };

    try {
      await mkdir(join(workspace, ".runstead"), { recursive: true });
      await writeFile(join(workspace, "notes.txt"), "before", "utf8");
      await writeFile(join(workspace, ".runstead", "state.db"), "keep", "utf8");
      const checkpoint = await createWorkspaceCheckpoint({
        workspace,
        checkpointDir,
        runner: createRunner,
        now: new Date("2026-05-14T00:00:00.000Z")
      });

      await writeFile(join(workspace, "notes.txt"), "after", "utf8");
      await writeFile(join(workspace, "new.txt"), "worker", "utf8");

      const result = await restoreWorkspaceCheckpoint({
        workspace,
        checkpointDir,
        checkpointId: checkpoint.id,
        runner: restoreRunner
      });

      expect(result).toMatchObject({
        currentHead: "abc123",
        restoredTrackedPatch: true,
        restoredUntrackedFiles: ["notes.txt"],
        removedUntrackedFiles: ["notes.txt", "new.txt"]
      });
      expect(restoreCalls).toContainEqual(["reset", "--hard", "abc123"]);
      expect(restoreCalls).toContainEqual([
        "apply",
        "--whitespace=nowarn",
        checkpoint.patchPath
      ]);
      await expect(readFile(join(workspace, "notes.txt"), "utf8")).resolves.toBe(
        "before"
      );
      await expect(access(join(workspace, "new.txt"))).rejects.toThrow();
      await expect(readFile(join(workspace, ".runstead", "state.db"), "utf8"))
        .resolves.toBe("keep");
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});
