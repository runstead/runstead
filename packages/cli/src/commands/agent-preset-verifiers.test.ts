import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { resolveAgentPresetVerifierOptions } from "./agent-preset-verifiers.js";

describe("agent preset verifier options", () => {
  it("uses the command-specific missing verifier message", async () => {
    await expect(
      resolveAgentPresetVerifierOptions({
        presetId: "repair:test",
        prompt: "",
        verifier: [],
        commandName: "agent repair-test",
        missingVerifierMessage:
          "agent repair-test requires at least one --verifier name=command, --verifier auto, or preset verifier"
      })
    ).rejects.toThrow(
      "agent repair-test requires at least one --verifier name=command, --verifier auto, or preset verifier"
    );
  });

  it("loads preset verifier overrides and re-renders verifier-aware prompts", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-agent-preset-"));

    try {
      await mkdir(join(workspace, ".runstead"), { recursive: true });
      await writeFile(
        join(workspace, ".runstead", "config.yaml"),
        "version: 1\n",
        "utf8"
      );
      await writeFile(
        join(workspace, ".runstead", "agent-presets.yaml"),
        ["presets:", "  test:triage:", "    verifier:", "      lint: pnpm lint"].join(
          "\n"
        ),
        "utf8"
      );

      const resolved = await resolveAgentPresetVerifierOptions({
        cwd: workspace,
        presetId: "test:triage",
        prompt: "Focus on failing lint output.",
        verifier: [],
        commandName: "agent test",
        missingVerifierMessage: "missing verifier"
      });

      expect(resolved.verifierCommands).toEqual([
        {
          name: "lint",
          command: "pnpm lint"
        }
      ]);
      expect(resolved.resolvedPreset.prompt).toContain("Configured verifiers: lint");
      expect(resolved.resolvedPreset.prompt).toContain("Focus on failing lint output.");
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});
