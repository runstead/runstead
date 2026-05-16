import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  formatRunsteadConfigSetResult,
  readRunsteadConfigValue,
  setRunsteadConfigValue
} from "./config.js";
import { initRunstead } from "./init.js";

describe("runstead config", () => {
  it("sets and reads codex.model in the local config file", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-config-"));

    try {
      await initRunstead({ cwd: workspace });

      const result = await setRunsteadConfigValue({
        cwd: workspace,
        key: "codex.model",
        value: " gpt-5.3-codex "
      });

      expect(result).toMatchObject({
        key: "codex.model",
        value: "gpt-5.3-codex"
      });
      expect(formatRunsteadConfigSetResult(result)).toContain(
        "Set codex.model: gpt-5.3-codex"
      );
      expect(
        await readRunsteadConfigValue({ cwd: workspace, key: "codex.model" })
      ).toBe("gpt-5.3-codex");
      expect(await readFile(result.path, "utf8")).toContain("codex:");
      expect(await readFile(result.path, "utf8")).toContain("model: gpt-5.3-codex");
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("rejects unsupported config keys", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-config-"));

    try {
      await initRunstead({ cwd: workspace });

      await expect(
        setRunsteadConfigValue({
          cwd: workspace,
          key: "codex.temperature",
          value: "1"
        })
      ).rejects.toThrow("Unsupported config key: codex.temperature");
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});
