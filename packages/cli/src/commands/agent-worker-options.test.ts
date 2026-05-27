import { describe, expect, it } from "vitest";

import {
  ALL_LOCAL_AGENT_WORKERS,
  CODEX_DIRECT_AGENT_WORKERS,
  parseAgentWorkerOption
} from "./agent-worker-options.js";

describe("parseAgentWorkerOption", () => {
  it("accepts codex_direct for strict agent commands", () => {
    expect(
      parseAgentWorkerOption({
        worker: "codex_direct",
        supported: CODEX_DIRECT_AGENT_WORKERS,
        unsupportedMessage: "unsupported"
      })
    ).toBe("codex_direct");
  });

  it("rejects wrapped workers for strict agent commands", () => {
    expect(() =>
      parseAgentWorkerOption({
        worker: "codex_cli",
        supported: CODEX_DIRECT_AGENT_WORKERS,
        unsupportedMessage: "strict command only supports codex_direct"
      })
    ).toThrow("strict command only supports codex_direct");
  });

  it("accepts all local agent workers for agent run", () => {
    expect(
      ALL_LOCAL_AGENT_WORKERS.map((worker) =>
        parseAgentWorkerOption({
          worker,
          supported: ALL_LOCAL_AGENT_WORKERS,
          unsupportedMessage: "unsupported"
        })
      )
    ).toEqual(["codex_direct", "codex_cli", "claude_code"]);
  });

  it("keeps the shared invalid worker parser message", () => {
    expect(() =>
      parseAgentWorkerOption({
        worker: "shell",
        supported: ALL_LOCAL_AGENT_WORKERS,
        unsupportedMessage: "unsupported"
      })
    ).toThrow("--worker must be codex_cli, claude_code, or codex_direct");
  });
});
