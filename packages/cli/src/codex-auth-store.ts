import {
  chmod,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

export interface CodexAuthStoreOptions {
  runsteadHome?: string;
  now?: Date;
}

export interface CodexAuthLockOptions extends CodexAuthStoreOptions {
  lockTimeoutMs?: number;
}

export interface CodexAuthStoreFile {
  version: 1;
  providers: Record<string, unknown>;
}

export function resolveRunsteadHome(options: CodexAuthStoreOptions = {}): string {
  const configured = options.runsteadHome ?? process.env.RUNSTEAD_HOME;

  if (configured !== undefined && configured.trim().length > 0) {
    return resolve(configured);
  }

  return join(homedir(), ".runstead");
}

export function codexAuthStorePath(options: CodexAuthStoreOptions = {}): string {
  return join(resolveRunsteadHome(options), "auth.json");
}

export function codexModelCachePath(options: CodexAuthStoreOptions = {}): string {
  return join(resolveRunsteadHome(options), "cache", "codex-models.json");
}

export async function withCodexAuthLock<T>(
  options: CodexAuthLockOptions,
  run: () => Promise<T>
): Promise<T> {
  const authPath = codexAuthStorePath(options);
  const lockPath = `${authPath}.lock`;
  const lockTimeoutMs = options.lockTimeoutMs ?? 30_000;
  const startedAt = Date.now();
  let handle: Awaited<ReturnType<typeof open>> | undefined;

  await mkdir(dirname(authPath), { recursive: true, mode: 0o700 });

  while (handle === undefined) {
    try {
      handle = await open(lockPath, "wx", 0o600);
      await handle.writeFile(`${process.pid}\n${new Date().toISOString()}\n`);
      break;
    } catch (error) {
      if (!isNodeErrorCode(error, "EEXIST")) {
        throw error;
      }

      if (Date.now() - startedAt > lockTimeoutMs) {
        throw new Error(`Timed out waiting for Codex auth lock at ${lockPath}`, {
          cause: error
        });
      }

      try {
        const lockStat = await stat(lockPath);
        if (Date.now() - lockStat.mtimeMs > Math.max(lockTimeoutMs * 2, 60_000)) {
          await rm(lockPath, { force: true });
        }
      } catch {
        // Another process may have released the lock between open and stat.
      }

      await sleep(50);
    }
  }

  try {
    return await run();
  } finally {
    await handle.close();
    await rm(lockPath, { force: true });
  }
}

export async function readCodexAuthStore(
  options: CodexAuthStoreOptions
): Promise<CodexAuthStoreFile> {
  const authPath = codexAuthStorePath(options);

  try {
    const text = await readFile(authPath, "utf8");
    const parsed = JSON.parse(text) as unknown;

    if (!isRecord(parsed)) {
      throw new Error("Codex auth store must be a JSON object");
    }

    const providers = isRecord(parsed.providers) ? parsed.providers : {};

    return {
      version: 1,
      providers: { ...providers }
    };
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) {
      return {
        version: 1,
        providers: {}
      };
    }

    throw error;
  }
}

export async function writeCodexAuthStore(
  authPath: string,
  store: CodexAuthStoreFile
): Promise<void> {
  await mkdir(dirname(authPath), { recursive: true, mode: 0o700 });
  await chmod(dirname(authPath), 0o700).catch(() => undefined);

  const tmpPath = `${authPath}.${process.pid}.${Date.now()}.tmp`;
  const serialized = `${JSON.stringify(store, null, 2)}\n`;

  await writeFile(tmpPath, serialized, { mode: 0o600 });
  await chmod(tmpPath, 0o600).catch(() => undefined);
  await rename(tmpPath, authPath);
  await chmod(authPath, 0o600).catch(() => undefined);
}

export function isNodeErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
