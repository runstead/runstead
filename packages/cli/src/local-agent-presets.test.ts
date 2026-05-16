import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { initRunstead } from "./init.js";
import {
  localAgentPresetIds,
  resolveConfiguredLocalAgentPreset,
  resolveLocalAgentPreset
} from "./local-agent-presets.js";

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
      "inspect:api",
      "inspect:architecture",
      "review:diff",
      "review:staged",
      "review:unpushed",
      "test:triage",
      "triage:failure",
      "fix:small",
      "fix:lint",
      "fix:typecheck",
      "repair:test",
      "repair:ci"
    ]);
  });

  it("loads repo preset overrides from .runstead/agent-presets.yaml", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-agent-presets-"));

    try {
      await initRunstead({ cwd: workspace });
      await writeFile(
        join(workspace, ".runstead", "agent-presets.yaml"),
        [
          "presets:",
          "  fix:small:",
          "    model: configured-codex",
          "    max_tool_calls: 40",
          "    max_turns: 20",
          "    max_failed_tool_calls: 6",
          "    prompt_focus: Keep the patch in src/.",
          "    verifier:",
          "      test: pnpm test"
        ].join("\n"),
        "utf8"
      );

      const resolved = await resolveConfiguredLocalAgentPreset(
        "fix:small",
        { prompt: "Fix the failing behavior." },
        { cwd: workspace }
      );

      expect(resolved).toMatchObject({
        model: "configured-codex",
        preset: {
          id: "fix:small",
          maxTurns: 20,
          maxToolCalls: 40,
          maxFailedToolCalls: 6
        },
        verifierCommands: [
          {
            name: "test",
            command: "pnpm test"
          }
        ]
      });
      expect(resolved.prompt).toContain("Keep the patch in src/.");
      expect(resolved.prompt).toContain("Fix the failing behavior.");
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("rejects unknown preset ids with the available list", () => {
    expect(() => resolveLocalAgentPreset("unknown")).toThrow(
      "Available presets: inspect:smoke"
    );
  });
});
