import { describe, expect, it } from "vitest";

import { formatDomainPackShowResult, showDomainPack } from "./domain-pack-command.js";

describe("domain pack command helpers", () => {
  it("shows fixture, eval, and manifest metadata for a resolved pack", async () => {
    const result = await showDomainPack("repo-maintenance");
    const report = formatDomainPackShowResult(result);

    expect(result.entry.id).toBe("repo-maintenance");
    expect(report).toContain("Domain pack: repo-maintenance");
    expect(report).toContain("Fixtures: 1 (js-test-failure)");
    expect(report).toContain("Evals: 1 (js-test-failure-smoke)");
    expect(report).toContain("Manifest files:");
    expect(report).toContain("Validation: valid");
  });
});
