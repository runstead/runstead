import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { chooseDefaultCodexModel, resolveCodexModel } from "./codex-model.js";
import { setRunsteadConfigValue } from "./config.js";
import { initRunstead } from "./init.js";

describe("Codex model resolution", () => {
  it("prefers explicit and configured models before discovery", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-codex-model-"));

    try {
      await initRunstead({ cwd: workspace });

      await setRunsteadConfigValue({
        cwd: workspace,
        key: "codex.model",
        value: "configured-codex"
      });

      await expect(
        resolveCodexModel({
          cwd: workspace,
          explicitModel: " cli-codex ",
          readCachedModels: () => Promise.resolve([]),
          listModels: () => Promise.resolve([])
        })
      ).resolves.toEqual({
        model: "cli-codex",
        source: "explicit"
      });
      await expect(
        resolveCodexModel({
          cwd: workspace,
          readCachedModels: () => Promise.resolve([]),
          listModels: () => Promise.resolve([])
        })
      ).resolves.toEqual({
        model: "configured-codex",
        source: "config"
      });
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("chooses the strongest Codex model from discovered models", () => {
    expect(
      chooseDefaultCodexModel([
        { id: "gpt-5.1-codex" },
        { id: "gpt-5.3-codex", contextWindow: 200_000 },
        { id: "gpt-5.3-codex-mini", contextWindow: 400_000 },
        { id: "gpt-5.2" }
      ])
    ).toBe("gpt-5.3-codex");
  });

  it("falls back to live model discovery when no local default exists", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-codex-model-"));
    const previousEnv = process.env.RUNSTEAD_CODEX_MODELS;

    try {
      delete process.env.RUNSTEAD_CODEX_MODELS;
      await initRunstead({ cwd: workspace });

      await expect(
        resolveCodexModel({
          cwd: workspace,
          readCachedModels: () => Promise.resolve([]),
          listModels: () =>
            Promise.resolve([
              { id: "gpt-5.1-codex", raw: {} },
              { id: "gpt-5.4-codex", raw: {} }
            ])
        })
      ).resolves.toEqual({
        model: "gpt-5.4-codex",
        source: "live"
      });
    } finally {
      if (previousEnv === undefined) {
        delete process.env.RUNSTEAD_CODEX_MODELS;
      } else {
        process.env.RUNSTEAD_CODEX_MODELS = previousEnv;
      }
      await rm(workspace, { force: true, recursive: true });
    }
  });
});
