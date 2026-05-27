import { describe, expect, it } from "vitest";

import { agentPresetTaskOptions } from "./agent-preset-task-options.js";

describe("agent preset task options", () => {
  it("maps resolved preset defaults into create task options", () => {
    expect(
      agentPresetTaskOptions(
        {
          provider: "openai",
          model: "explicit-model",
          maxToolCalls: "30"
        },
        {
          prompt: "Preset prompt",
          model: "preset-model",
          preset: {
            id: "fix:small",
            mode: "edit",
            checkpoint: true,
            maxTurns: 10,
            maxToolCalls: 20,
            maxFailedToolCalls: 5,
            verifierPolicy: "auto",
            promptTemplate: () => "Preset prompt"
          }
        }
      )
    ).toEqual({
      prompt: "Preset prompt",
      preset: "fix:small",
      provider: "openai",
      model: "explicit-model",
      mode: "edit",
      checkpoint: true,
      maxTurns: 10,
      maxToolCalls: 30,
      maxFailedToolCalls: 5
    });
  });
});
