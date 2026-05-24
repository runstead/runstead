import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export * from "./security-fixtures.js";
export * from "./control-plane-conformance.js";

export interface TempWorkspace {
  path: string;
  cleanup: () => Promise<void>;
}

export async function createTempWorkspace(
  prefix = "runstead-"
): Promise<TempWorkspace> {
  const path = await mkdtemp(join(tmpdir(), prefix));

  return {
    path,
    cleanup: () => rm(path, { force: true, recursive: true })
  };
}
