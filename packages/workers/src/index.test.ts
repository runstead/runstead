import { describe, expect, it } from "vitest";

import {
  isRunsteadWorkerKind,
  listWorkerGovernanceCapabilities,
  workerGovernanceCapability
} from "./index.js";

describe("worker governance contracts", () => {
  it("marks codex_direct as governed execution", () => {
    expect(workerGovernanceCapability("codex_direct")).toMatchObject({
      level: "governed_execution",
      hardProxyToolCalls: true
    });
  });

  it("marks wrapped workers as readiness wrappers", () => {
    expect(workerGovernanceCapability("codex_cli")).toMatchObject({
      level: "readiness_wrapper",
      hardProxyToolCalls: false
    });
    expect(workerGovernanceCapability("claude_code")).toMatchObject({
      level: "readiness_wrapper",
      hardProxyToolCalls: false
    });
  });

  it("lists and narrows supported worker kinds", () => {
    expect(listWorkerGovernanceCapabilities()).toHaveLength(3);
    expect(isRunsteadWorkerKind("codex_cli")).toBe(true);
    expect(isRunsteadWorkerKind("shell")).toBe(false);
  });
});
