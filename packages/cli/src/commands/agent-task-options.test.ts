import { describe, expect, it } from "vitest";

import { agentTaskModelOptions } from "./agent-task-options.js";

describe("agent task options", () => {
  it("uses explicit model routing before preset defaults", () => {
    expect(
      agentTaskModelOptions(
        {
          provider: "openai",
          model: "explicit-model",
          baseUrl: "https://example.test/v1"
        },
        "preset-model"
      )
    ).toEqual({
      provider: "openai",
      model: "explicit-model",
      baseUrl: "https://example.test/v1"
    });
  });

  it("uses the preset model when the CLI model is unset", () => {
    expect(agentTaskModelOptions({}, "preset-model")).toEqual({
      model: "preset-model"
    });
  });

  it("omits unset model routing fields", () => {
    expect(agentTaskModelOptions({})).toEqual({});
  });
});
