import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  assessDomainPackMaturity,
  formatDomainPackMaturityResult
} from "./maturity.js";
import { createDomainPackTemplate } from "./template.js";

describe("assessDomainPackMaturity", () => {
  it("passes the ai-native-startup pack maturity gate", async () => {
    const packRoot = fileURLToPath(
      new URL("../packs/ai-native-startup", import.meta.url)
    );

    const result = await assessDomainPackMaturity(packRoot);
    const report = formatDomainPackMaturityResult(result);

    expect(result.passed).toBe(true);
    expect(result.score).toBe(1);
    expect(result.checks.map((check) => check.id)).toEqual([
      "validation",
      "schema-versioning",
      "repo-templates",
      "gate-thresholds",
      "report-sections",
      "eval-quality",
      "fixture-coverage"
    ]);
    expect(report).toContain("Status: passed");
    expect(report).toContain("Repo type templates cover multiple domain surfaces");
  });

  it("passes the research-monitor pack maturity gate", async () => {
    const packRoot = fileURLToPath(
      new URL("../packs/research-monitor", import.meta.url)
    );

    const result = await assessDomainPackMaturity(packRoot);
    const report = formatDomainPackMaturityResult(result);

    expect(result.passed).toBe(true);
    expect(result.score).toBe(1);
    expect(report).toContain("Status: passed");
    expect(report).toContain("gate-thresholds");
    expect(report).toContain("assess");
    expect(report).toContain("archive");
  });

  it("passes the email-followup pack maturity gate", async () => {
    const packRoot = fileURLToPath(new URL("../packs/email-followup", import.meta.url));

    const result = await assessDomainPackMaturity(packRoot);
    const report = formatDomainPackMaturityResult(result);

    expect(result.passed).toBe(true);
    expect(result.score).toBe(1);
    expect(report).toContain("Status: passed");
    expect(report).toContain("send-approval");
    expect(report).toContain("draft-quality");
    expect(report).toContain("send_not_performed");
  });

  it("flags starter packs that lack domain maturity metadata", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-domain-maturity-"));

    try {
      const template = await createDomainPackTemplate({
        id: "customer-ops",
        outputDir: join(workspace, "customer-ops")
      });

      const result = await assessDomainPackMaturity(template.root);

      expect(result.passed).toBe(false);
      expect(
        result.checks.filter((check) => !check.passed).map((check) => check.id)
      ).toEqual(
        expect.arrayContaining([
          "schema-versioning",
          "repo-templates",
          "gate-thresholds",
          "report-sections",
          "eval-quality",
          "fixture-coverage"
        ])
      );
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});
