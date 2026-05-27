import { describe, expect, it } from "vitest";

import { agentRunTaskOptions } from "./agent-run-task-options.js";

describe("agent run task options", () => {
  it("builds task options without a preset", () => {
    expect(
      agentRunTaskOptions({
        options: {
          mode: "repair",
          allowed: ["src/**"],
          denied: [".runstead/**"],
          model: "explicit-model",
          maxTurns: "4"
        },
        prompt: "Repair the issue",
        verifierCommands: [{ name: "test", command: "pnpm test" }]
      })
    ).toEqual({
      prompt: "Repair the issue",
      model: "explicit-model",
      mode: "repair",
      allowedPaths: ["src/**"],
      deniedPaths: [".runstead/**"],
      verifierCommands: [{ name: "test", command: "pnpm test" }],
      maxTurns: 4
    });
  });

  it("uses preset prompt, mode, checkpoint, model, and budgets", () => {
    expect(
      agentRunTaskOptions({
        options: {
          mode: "read-only",
          allowed: [],
          denied: []
        },
        prompt: "Ignored prompt",
        resolvedPreset: {
          prompt: "Preset prompt",
          model: "preset-model",
          preset: {
            id: "inspect:smoke",
            mode: "read-only",
            checkpoint: false,
            maxTurns: 8,
            maxToolCalls: 8,
            maxFailedToolCalls: 3,
            verifierPolicy: "none",
            promptTemplate: () => "Preset prompt"
          }
        },
        verifierCommands: []
      })
    ).toEqual({
      prompt: "Preset prompt",
      preset: "inspect:smoke",
      checkpoint: false,
      model: "preset-model",
      mode: "read-only",
      allowedPaths: [],
      deniedPaths: [],
      verifierCommands: [],
      maxTurns: 8,
      maxToolCalls: 8,
      maxFailedToolCalls: 3
    });
  });
});
