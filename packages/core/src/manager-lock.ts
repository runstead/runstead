import { mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface ManagerLockMetadata {
  ownerId: string;
  pid: number;
  acquiredAt: string;
  heartbeatAt: string;
}

export interface ManagerLock {
  metadata: ManagerLockMetadata;
  heartbeat: () => Promise<void>;
  release: () => Promise<void>;
}

export interface AcquireManagerLockOptions {
  lockPath: string;
  ownerId?: string;
  pid?: number;
  now?: () => Date;
  staleAfterMs?: number;
  processExists?: (pid: number) => boolean;
}

export class ManagerLockAlreadyHeldError extends Error {
  constructor(lockPath: string, metadata: ManagerLockMetadata | null) {
    super(
      metadata === null
        ? `Runstead manager lock is already held at ${lockPath}`
        : `Runstead manager lock is already held at ${lockPath} by ${metadata.ownerId}`
    );
    this.name = "ManagerLockAlreadyHeldError";
  }
}

export class ManagerLockLostError extends Error {
  constructor(lockPath: string, metadata: ManagerLockMetadata) {
    super(
      `Runstead manager lock at ${lockPath} is no longer held by ${metadata.ownerId}`
    );
    this.name = "ManagerLockLostError";
  }
}

const DEFAULT_STALE_AFTER_MS = 10 * 60 * 1000;

export async function acquireManagerLock(
  options: AcquireManagerLockOptions
): Promise<ManagerLock> {
  const now = options.now ?? (() => new Date());
  const ownerId = options.ownerId ?? `pid:${process.pid}`;
  const pid = options.pid ?? process.pid;
  const staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
  const processExists = options.processExists ?? defaultProcessExists;

  const metadata = createMetadata({ ownerId, pid, now });

  try {
    await writeLockFile(options.lockPath, metadata);
    return createManagerLock(options.lockPath, metadata, now);
  } catch (error) {
    if (!isFileAlreadyExistsError(error)) {
      throw error;
    }
  }

  const existing = await readLockMetadata(options.lockPath);

  if (existing === null) {
    throw new ManagerLockAlreadyHeldError(options.lockPath, existing);
  }

  if (!isStaleLock(existing, now(), staleAfterMs) || processExists(existing.pid)) {
    throw new ManagerLockAlreadyHeldError(options.lockPath, existing);
  }

  await rm(options.lockPath, { force: true });
  await writeLockFile(options.lockPath, metadata);

  return createManagerLock(options.lockPath, metadata, now);
}

function createManagerLock(
  lockPath: string,
  metadata: ManagerLockMetadata,
  now: () => Date
): ManagerLock {
  return {
    metadata,
    heartbeat: async () => {
      const current = await readLockMetadata(lockPath);

      if (!isSameLockOwner(current, metadata)) {
        throw new ManagerLockLostError(lockPath, metadata);
      }

      metadata.heartbeatAt = now().toISOString();
      await writeFile(lockPath, `${JSON.stringify(metadata)}\n`, "utf8");
    },
    release: async () => {
      const current = await readLockMetadata(lockPath);

      if (isSameLockOwner(current, metadata)) {
        await rm(lockPath, { force: true });
      }
    }
  };
}

async function writeLockFile(
  lockPath: string,
  metadata: ManagerLockMetadata
): Promise<void> {
  await mkdir(dirname(lockPath), { recursive: true });

  const file = await open(lockPath, "wx");

  try {
    await file.writeFile(`${JSON.stringify(metadata)}\n`, "utf8");
  } finally {
    await file.close();
  }
}

function createMetadata(input: {
  ownerId: string;
  pid: number;
  now: () => Date;
}): ManagerLockMetadata {
  const timestamp = input.now().toISOString();

  return {
    ownerId: input.ownerId,
    pid: input.pid,
    acquiredAt: timestamp,
    heartbeatAt: timestamp
  };
}

async function readLockMetadata(lockPath: string): Promise<ManagerLockMetadata | null> {
  try {
    const raw = await readFile(lockPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<ManagerLockMetadata>;

    if (
      typeof parsed.ownerId !== "string" ||
      typeof parsed.pid !== "number" ||
      typeof parsed.acquiredAt !== "string" ||
      typeof parsed.heartbeatAt !== "string"
    ) {
      return null;
    }

    return {
      ownerId: parsed.ownerId,
      pid: parsed.pid,
      acquiredAt: parsed.acquiredAt,
      heartbeatAt: parsed.heartbeatAt
    };
  } catch {
    return null;
  }
}

function isStaleLock(
  metadata: ManagerLockMetadata,
  now: Date,
  staleAfterMs: number
): boolean {
  const heartbeatAt = new Date(metadata.heartbeatAt).getTime();

  return Number.isFinite(heartbeatAt) && now.getTime() - heartbeatAt > staleAfterMs;
}

function isSameLockOwner(
  current: ManagerLockMetadata | null,
  expected: ManagerLockMetadata
): boolean {
  return (
    current !== null &&
    current.ownerId === expected.ownerId &&
    current.pid === expected.pid &&
    current.acquiredAt === expected.acquiredAt
  );
}

function defaultProcessExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function isFileAlreadyExistsError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "EEXIST"
  );
}
