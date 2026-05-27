import { describe, expect, it } from "vitest";

import {
  assertSingleReviewScope,
  localAgentReviewGitDiffBase,
  localAgentReviewPresetId,
  localAgentReviewScope
} from "./agent-review-scope.js";

describe("agent review scope", () => {
  it("defaults to unstaged diff review", () => {
    const scope = localAgentReviewScope({});

    expect(scope).toMatchObject({
      kind: "unstaged",
      title: "unstaged diff"
    });
    expect(localAgentReviewPresetId(scope)).toBe("review:diff");
    expect(localAgentReviewGitDiffBase(scope)).toBeUndefined();
  });

  it("maps staged review to the staged preset", () => {
    const scope = localAgentReviewScope({ staged: true });

    expect(scope.kind).toBe("staged");
    expect(localAgentReviewPresetId(scope)).toBe("review:staged");
    expect(scope.gitDiffInstruction).toContain("staged=true");
  });

  it("maps unpushed review to upstream diff base", () => {
    const scope = localAgentReviewScope({ unpushed: true });

    expect(scope.kind).toBe("unpushed");
    expect(localAgentReviewPresetId(scope)).toBe("review:unpushed");
    expect(localAgentReviewGitDiffBase(scope)).toBe("@{upstream}");
  });

  it("maps explicit base review to review:diff with the requested base", () => {
    const scope = localAgentReviewScope({ base: "origin/main" });

    expect(scope).toMatchObject({
      kind: "base",
      base: "origin/main",
      title: "origin/main...HEAD"
    });
    expect(localAgentReviewPresetId(scope)).toBe("review:diff");
    expect(localAgentReviewGitDiffBase(scope)).toBe("origin/main");
  });

  it("rejects multiple review scopes", () => {
    expect(() =>
      assertSingleReviewScope({
        staged: true,
        base: "origin/main"
      })
    ).toThrow("agent review accepts only one of --staged, --base, or --unpushed");
  });
});
