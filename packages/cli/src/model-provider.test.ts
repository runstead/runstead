import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { initRunstead } from "./init.js";
import {
  getModelProviderProfile,
  listModelProviderProfiles,
  resolveModelProvider
} from "./model-provider.js";
import { setRunsteadConfigValue } from "./config.js";

describe("model provider registry", () => {
  it("registers Hermes-inspired provider profiles and aliases", () => {
    expect(listModelProviderProfiles().map((profile) => profile.id)).toEqual(
      expect.arrayContaining([
        "codex",
        "openai",
        "openrouter",
        "anthropic",
        "gemini",
        "nous-api",
        "deepseek",
        "zai",
        "kimi-coding",
        "minimax",
        "huggingface",
        "nvidia",
        "lmstudio",
        "custom"
      ])
    );
    expect(getModelProviderProfile("openai-codex")).toMatchObject({
      id: "codex",
      apiMode: "codex_responses"
    });
    expect(getModelProviderProfile("ollama")).toMatchObject({
      id: "custom",
      apiMode: "openai_chat_completions"
    });
  });

  it("resolves explicit, configured, environment, and legacy Codex defaults", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-model-provider-"));

    try {
      await initRunstead({ cwd: workspace });
      await setRunsteadConfigValue({
        cwd: workspace,
        key: "codex.model",
        value: "gpt-5.3-codex"
      });

      await expect(
        resolveModelProvider({ cwd: workspace, env: {} })
      ).resolves.toMatchObject({
        provider: "codex",
        providerSource: "default",
        model: "gpt-5.3-codex",
        modelSource: "legacy_codex_config"
      });

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

      await expect(
        resolveModelProvider({ cwd: workspace, env: {} })
      ).resolves.toMatchObject({
        provider: "openrouter",
        providerSource: "config",
        model: "anthropic/claude-opus-4.6",
        modelSource: "config",
        baseUrl: "https://openrouter.ai/api/v1"
      });

      await expect(
        resolveModelProvider({
          cwd: workspace,
          explicitProvider: "anthropic",
          explicitModel: "claude-opus-4.6",
          env: {}
        })
      ).resolves.toMatchObject({
        provider: "anthropic",
        providerSource: "explicit",
        model: "claude-opus-4.6",
        modelSource: "explicit"
      });

      await expect(
        resolveModelProvider({
          cwd: workspace,
          env: {
            RUNSTEAD_MODEL_PROVIDER: "gemini",
            RUNSTEAD_MODEL: "gemini-2.5-pro"
          }
        })
      ).resolves.toMatchObject({
        provider: "openrouter",
        providerSource: "config"
      });
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("infers obvious native providers from explicit model names", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-model-provider-"));

    try {
      await initRunstead({ cwd: workspace });

      await expect(
        resolveModelProvider({
          cwd: workspace,
          explicitModel: "claude-opus-4.6",
          env: {}
        })
      ).resolves.toMatchObject({
        provider: "anthropic",
        providerSource: "model_prefix"
      });
      await expect(
        resolveModelProvider({
          cwd: workspace,
          explicitModel: "gemini-2.5-flash",
          env: {}
        })
      ).resolves.toMatchObject({
        provider: "gemini",
        providerSource: "model_prefix"
      });
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});
