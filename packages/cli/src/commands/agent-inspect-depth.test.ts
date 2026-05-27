import { describe, expect, it } from "vitest";

import { localAgentInspectPresetId } from "./agent-inspect-depth.js";

describe("agent inspect depth", () => {
  it("maps CLI depth values to local agent presets", () => {
    expect(localAgentInspectPresetId("smoke")).toBe("inspect:smoke");
    expect(localAgentInspectPresetId("standard")).toBe("inspect:standard");
  });

  it("rejects unsupported depth values", () => {
    expect(() => localAgentInspectPresetId("architecture")).toThrow(
      "--depth must be smoke or standard"
    );
  });
});
