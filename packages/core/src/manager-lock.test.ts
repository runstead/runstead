import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { acquireManagerLock, ManagerLockAlreadyHeldError } from "./manager-lock.js";

describe("acquireManagerLock", () => {
  it("creates and releases an exclusive lock file", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-lock-"));
    const lockPath = join(workspace, ".runstead", "lock");

    try {
      const lock = await acquireManagerLock({
        lockPath,
        ownerId: "test-owner",
        pid: 123,
        now: () => new Date("2026-05-13T10:00:00.000Z")
      });

      const raw = await readFile(lockPath, "utf8");
      expect(JSON.parse(raw)).toMatchObject({
        ownerId: "test-owner",
        pid: 123,
        acquiredAt: "2026-05-13T10:00:00.000Z",
        heartbeatAt: "2026-05-13T10:00:00.000Z"
      });

      await lock.release();
      await expect(stat(lockPath)).rejects.toThrow();
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("rejects a fresh lock held by another live manager", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-lock-"));
    const lockPath = join(workspace, ".runstead", "lock");

    try {
      await acquireManagerLock({
        lockPath,
        ownerId: "first",
        pid: 123,
        now: () => new Date("2026-05-13T10:00:00.000Z")
      });

      await expect(
        acquireManagerLock({
          lockPath,
          ownerId: "second",
          pid: 456,
          now: () => new Date("2026-05-13T10:01:00.000Z"),
          processExists: () => true
        })
      ).rejects.toThrow(ManagerLockAlreadyHeldError);
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("recovers a stale lock whose owner process is gone", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-lock-"));
    const lockPath = join(workspace, ".runstead", "lock");

    try {
      await mkdir(join(workspace, ".runstead"), { recursive: true });
      await writeFile(
        lockPath,
        `${JSON.stringify({
          ownerId: "stale",
          pid: 123,
          acquiredAt: "2026-05-13T09:00:00.000Z",
          heartbeatAt: "2026-05-13T09:00:00.000Z"
        })}\n`,
        "utf8"
      );

      const lock = await acquireManagerLock({
        lockPath,
        ownerId: "recovered",
        pid: 456,
        staleAfterMs: 10 * 60 * 1000,
        now: () => new Date("2026-05-13T10:00:00.000Z"),
        processExists: () => false
      });

      expect(lock.metadata).toMatchObject({
        ownerId: "recovered",
        pid: 456
      });
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("updates heartbeat timestamps without changing the owner", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-lock-"));
    const lockPath = join(workspace, ".runstead", "lock");
    let now = new Date("2026-05-13T10:00:00.000Z");

    try {
      const lock = await acquireManagerLock({
        lockPath,
        ownerId: "heartbeat",
        pid: 123,
        now: () => now
      });

      now = new Date("2026-05-13T10:05:00.000Z");
      await lock.heartbeat();

      const raw = await readFile(lockPath, "utf8");
      expect(JSON.parse(raw)).toMatchObject({
        ownerId: "heartbeat",
        acquiredAt: "2026-05-13T10:00:00.000Z",
        heartbeatAt: "2026-05-13T10:05:00.000Z"
      });
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});
