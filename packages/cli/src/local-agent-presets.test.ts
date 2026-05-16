import { describe, expect, it } from "vitest";

import { localAgentPresetIds, resolveLocalAgentPreset } from "./local-agent-presets.js";

describe("local agent presets", () => {
  it("resolves inspect smoke with conservative defaults", () => {
    const resolved = resolveLocalAgentPreset("inspect:smoke", {
      prompt: "Focus on package scripts."
    });

    expect(resolved.preset).toMatchObject({
      id: "inspect:smoke",
      mode: "read-only",
      maxTurns: 8,
      maxToolCalls: 8,
      maxFailedToolCalls: 3,
      checkpoint: false,
      verifierPolicy: "none"
    });
    expect(resolved.prompt).toContain("Task preset: inspect:smoke");
    expect(resolved.prompt).toContain("User focus:");
    expect(resolved.prompt).toContain("Focus on package scripts.");
    expect(resolved.prompt).toContain("Stop rules:");
  });

  it("publishes all initial task product presets", () => {
    expect(localAgentPresetIds()).toEqual([
      "inspect:smoke",
      "inspect:standard",
      "review:diff",
      "test:triage",
      "fix:small",
      "repair:test",
      "repair:ci"
    ]);
  });

  it("rejects unknown preset ids with the available list", () => {
    expect(() => resolveLocalAgentPreset("unknown")).toThrow(
      "Available presets: inspect:smoke"
    );
  });
});
