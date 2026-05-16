import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { initRunstead } from "./init.js";
import {
  createModelProviderRuntime,
  resolveModelProviderModel
} from "./model-provider-runtime.js";
import { setRunsteadConfigValue } from "./config.js";

describe("model provider runtime", () => {
  it("resolves OpenAI-compatible providers from config and environment", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-model-runtime-"));

    try {
      await initRunstead({ cwd: workspace });
      await setRunsteadConfigValue({
        cwd: workspace,
        key: "model.provider",
        value: "openrouter"
      });
      await setRunsteadConfigValue({
        cwd: workspace,
        key: "model.name",
        value: "anthropic/claude-opus-4.6"
      });

      const runtime = await createModelProviderRuntime({
        cwd: workspace,
        env: {
          OPENROUTER_API_KEY: "openrouter-token"
        }
      });

      expect(runtime).toMatchObject({
        model: "anthropic/claude-opus-4.6",
        modelProviderResourceId: "openrouter",
        networkDomains: ["openrouter.ai"]
      });
      expect(runtime.selection.profile.apiMode).toBe("openai_chat_completions");
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("allows local custom OpenAI-compatible endpoints without API keys", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-model-runtime-"));

    try {
      await initRunstead({ cwd: workspace });

      const runtime = await createModelProviderRuntime({
        cwd: workspace,
        explicitProvider: "custom",
        explicitModel: "local-model",
        explicitBaseUrl: "http://127.0.0.1:11434/v1",
        env: {}
      });

      expect(runtime).toMatchObject({
        model: "local-model",
        modelProviderResourceId: "custom",
        networkDomains: ["127.0.0.1"]
      });
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("requires model names and provider credentials when needed", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-model-runtime-"));

    try {
      await initRunstead({ cwd: workspace });

      await expect(
        resolveModelProviderModel({
          cwd: workspace,
          explicitProvider: "anthropic",
          env: {}
        })
      ).rejects.toThrow("No model selected for provider anthropic");

      await expect(
        createModelProviderRuntime({
          cwd: workspace,
          explicitProvider: "anthropic",
          explicitModel: "claude-opus-4.6",
          env: {}
        })
      ).rejects.toThrow("requires an API key");
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});
