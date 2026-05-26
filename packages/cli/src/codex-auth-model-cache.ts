import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { CODEX_PROVIDER_ID } from "./codex-auth-constants.js";
import {
  codexModelCachePath,
  isNodeErrorCode,
  type CodexAuthStoreOptions
} from "./codex-auth-store.js";
import { isRecord, parseCodexModelsPayload } from "./codex-auth-parsers.js";
import type { CodexModel, CodexModelCacheFile } from "./codex-auth-types.js";

export async function readCodexModelCache(
  options: CodexAuthStoreOptions = {}
): Promise<CodexModel[]> {
  try {
    const raw = JSON.parse(
      await readFile(codexModelCachePath(options), "utf8")
    ) as unknown;

    if (!isRecord(raw) || !Array.isArray(raw.models)) {
      return [];
    }

    return parseCodexModelsPayload({ models: raw.models });
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) {
      return [];
    }

    throw error;
  }
}

export async function writeCodexModelCache(
  models: CodexModel[],
  options: CodexAuthStoreOptions
): Promise<void> {
  const cachePath = codexModelCachePath(options);
  const payload: CodexModelCacheFile = {
    version: 1,
    provider: CODEX_PROVIDER_ID,
    fetchedAt: (options.now ?? new Date()).toISOString(),
    models
  };
  const tmpPath = `${cachePath}.${process.pid}.${Date.now()}.tmp`;

  await mkdir(dirname(cachePath), { recursive: true, mode: 0o700 });
  await writeFile(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  await chmod(tmpPath, 0o600).catch(() => undefined);
  await rename(tmpPath, cachePath);
  await chmod(cachePath, 0o600).catch(() => undefined);
}
