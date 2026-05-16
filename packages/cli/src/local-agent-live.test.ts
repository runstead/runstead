import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { initRunstead } from "./init.js";
import { createLocalAgentTask, runLocalAgentTask } from "./local-agent.js";

const runLiveSmoke = process.env.RUNSTEAD_LIVE_CODEX_DIRECT === "1";

describe("local agent live Codex Direct smoke", () => {
  it.skipIf(!runLiveSmoke)(
    "runs a real read-only local agent task",
    async () => {
      const workspace = await mkdtemp(join(tmpdir(), "runstead-live-agent-"));
      const model = process.env.RUNSTEAD_LIVE_CODEX_MODEL ?? "gpt-5.3-codex";

      try {
        await initRunstead({ cwd: workspace, profile: "trusted-local" });
        const created = await createLocalAgentTask({
          cwd: workspace,
          prompt: "Inspect this temporary repo and respond with a short summary.",
          worker: "codex_direct",
          model,
          mode: "read-only",
          maxTurns: 2
        });
        const result = await runLocalAgentTask({
          cwd: workspace,
          taskId: created.task.id
        });

        expect(result.status).toBe("completed");
        expect(result.summary.length).toBeGreaterThan(0);
        expect(result.audit.toolCalls.length).toBeGreaterThan(0);
      } finally {
        await rm(workspace, { force: true, recursive: true });
      }
    },
    60_000
  );
});
