import { describe, expect, it } from "vitest";

import {
  parseLocalAgentMode,
  resolveAgentRunPresetOptions
} from "./agent-run-options.js";

describe("agent run options", () => {
  it("parses supported local agent modes", () => {
    expect(parseLocalAgentMode("read-only")).toBe("read-only");
    expect(parseLocalAgentMode("edit")).toBe("edit");
    expect(parseLocalAgentMode("repair")).toBe("repair");
  });

  it("rejects unsupported local agent modes", () => {
    expect(() => parseLocalAgentMode("observe")).toThrow(
      "--mode must be read-only, edit, or repair"
    );
  });

  it("requires a prompt when no preset is set", async () => {
    await expect(
      resolveAgentRunPresetOptions({
        prompt: "",
        verifier: []
      })
    ).rejects.toThrow("agent run prompt is required unless --preset is set");
  });

  it("allows a prompt without a preset", async () => {
    await expect(
      resolveAgentRunPresetOptions({
        prompt: "Inspect the app",
        verifier: []
      })
    ).resolves.toMatchObject({
      verifierCommands: [],
      runPresetVerifiersFirst: false
    });
  });
});
