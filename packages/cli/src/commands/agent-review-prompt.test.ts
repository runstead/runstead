import { describe, expect, it } from "vitest";

import { localAgentReviewPrompt } from "./agent-review-prompt.js";
import { localAgentReviewScope } from "./agent-review-scope.js";

describe("agent review prompt", () => {
  it("builds the scope-only review prompt", () => {
    expect(
      localAgentReviewPrompt({
        scope: localAgentReviewScope({ staged: true }),
        focus: ""
      })
    ).toBe(
      [
        "Review the staged git diff only.",
        "When calling git_diff, pass staged=true."
      ].join("\n")
    );
  });

  it("appends operator focus after git diff instructions", () => {
    expect(
      localAgentReviewPrompt({
        scope: localAgentReviewScope({ base: "origin/main" }),
        focus: "Focus on public API changes."
      })
    ).toContain(
      [
        "Review the git diff from origin/main to HEAD only.",
        "When calling git_diff, pass base='origin/main' and leave staged unset.",
        "Focus on public API changes."
      ].join("\n")
    );
  });
});
