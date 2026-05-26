import type { CodexDirectWorkerOptions } from "./worker.js";
import { CODEX_DIRECT_WORKER_KIND } from "./constants.js";
import { codexDirectToolDefinitions } from "./tool-catalog.js";

export { codexDirectToolDefinitions, objectSchema } from "./tool-catalog.js";

export function buildCodexDirectInstructions(
  options: Pick<CodexDirectWorkerOptions, "cwd" | "evidenceDir" | "goal" | "task">
): string {
  return [
    "You are a Runstead-native Codex worker.",
    "",
    "Every tool call is executed by Runstead through policy, approval, and audit.",
    "If a tool requires approval or is denied, stop and report the blocker.",
    "Do not request push, publish, or pull-request creation; Runstead owns those stages.",
    "",
    "Governance manifest:",
    JSON.stringify(
      {
        worker: CODEX_DIRECT_WORKER_KIND,
        enforcement: "hard_proxy_tool_calls",
        workspace: options.cwd,
        evidenceDir: options.evidenceDir,
        goalId: options.goal.id,
        taskId: options.task.id,
        exposedTools: codexDirectToolDefinitions().map((tool) => tool.name),
        durableStorageRules: [
          "Do not store access tokens.",
          "Do not store complete prompts.",
          "Do not store raw model output beyond concise summaries."
        ]
      },
      null,
      2
    )
  ].join("\n");
}
