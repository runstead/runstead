import { join, resolve } from "node:path";

import { acquireManagerLock, type ManagerLock } from "@runstead/core";

import { requireRunsteadRootSync } from "./runstead-root.js";

export interface WithRunsteadManagerLockOptions {
  cwd?: string;
  ownerId?: string;
}

export async function withRunsteadManagerLock<T>(
  options: WithRunsteadManagerLockOptions,
  callback: (lock: ManagerLock) => Promise<T>
): Promise<T> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const root = requireRunsteadRootSync(cwd).root;
  const lock = await acquireManagerLock({
    lockPath: join(root, "manager.lock"),
    ...(options.ownerId === undefined ? {} : { ownerId: options.ownerId })
  });

  try {
    return await callback(lock);
  } finally {
    await lock.release();
  }
}
