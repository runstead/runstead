import type { LocalAgentReviewScope } from "./agent-review-scope.js";

export function localAgentReviewPrompt(input: {
  scope: LocalAgentReviewScope;
  focus: string;
}): string {
  return [
    input.scope.prompt,
    input.scope.gitDiffInstruction,
    ...(input.focus.length === 0 ? [] : [input.focus])
  ].join("\n");
}
