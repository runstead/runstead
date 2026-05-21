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

  it("shows startup pack maturity metadata for founder-facing domain packs", async () => {
    const result = await showDomainPack("ai-native-startup");
    const report = formatDomainPackShowResult(result);

    expect(result.entry.id).toBe("ai-native-startup");
    expect(result.maturity.passed).toBe(true);
    expect(report).toContain(
      "Repo templates: 4 (saas, chrome-extension, api-service, landing-waitlist)"
    );
    expect(report).toContain("Gate thresholds: 3 (mvp, launch, scale)");
    expect(report).toContain(
      "Report sections: 3 (repo-readiness, measurement, security-launch-risk)"
    );
    expect(report).toContain("Migrations: 1 (0.0.0->0.1.0)");
    expect(report).toContain("Maturity: passed (100%)");
  });
});
