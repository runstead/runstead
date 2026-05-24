import type { CodexDirectWorkerOptions } from "./worker.js";

export function buildCodexDirectUserPrompt(
  options: Pick<CodexDirectWorkerOptions, "goal" | "task">
): string {
  return [
    `Goal: ${options.goal.title} (${options.goal.id})`,
    `Task: ${options.task.type} (${options.task.id})`,
    "",
    "Task input:",
    JSON.stringify(options.task.input, null, 2),
    "",
    "Verifiers:",
    options.task.verifiers.map((verifier) => `- ${verifier}`).join("\n") || "- none"
  ].join("\n");
}
