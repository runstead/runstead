import { describe, expect, it } from "vitest";

import { formatDomainPackShowResult, showDomainPack } from "./domain-pack-command.js";

describe("domain pack command helpers", () => {
  it("shows fixture, eval, and manifest metadata for a resolved pack", async () => {
    const result = await showDomainPack("repo-maintenance");
    const report = formatDomainPackShowResult(result);

    expect(result.entry.id).toBe("repo-maintenance");
    expect(report).toContain("Domain pack: repo-maintenance");
    expect(report).toContain("Work pack: repo-maintenance");
    expect(report).toContain(
      "Workflows: 4 (keep-ci-green:goal_template, repo_inspect:task_type, run_local_verifiers:task_type, ci_repair:task_type)"
    );
    expect(report).toContain("Work pack components: 1 (repo-maintenance:domain_pack)");
    expect(report).toContain(
      "Capability reads: 4 (filesystem.repo, git.status, git.diff, github.workflow_run)"
    );
    expect(report).toContain(
      "Capability denied: 2 (secret_read, production_infra_write)"
    );
    expect(report).toContain("Evidence contracts: 1 (keep-ci-green)");
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

  it("shows non-startup golden-path metadata for mature built-in packs", async () => {
    const research = await showDomainPack("research-monitor");
    const researchReport = formatDomainPackShowResult(research);
    const email = await showDomainPack("email-followup");
    const emailReport = formatDomainPackShowResult(email);

    expect(research.maturity.passed).toBe(true);
    expect(researchReport).toContain("Domain pack: research-monitor");
    expect(researchReport).toContain(
      "Task types: 7 (discover_sources, scan_sources, evaluate_source_reliability, summarize_findings, triage_source_conflicts, prepare_digest_release, archive_research_memory)"
    );
    expect(researchReport).toContain(
      "Fixtures: 6 (source-discovery-review, source-reliability-review, weekly-research-digest-smoke, conflicting-sources-regression, publish-gate-review, archive-memory-update)"
    );
    expect(researchReport).toContain("Report sections: 5");
    expect(researchReport).toContain("Maturity: passed (100%)");

    expect(email.maturity.passed).toBe(true);
    expect(emailReport).toContain("Domain pack: email-followup");
    expect(emailReport).toContain(
      "Task types: 6 (scan_threads, classify_followup_need, verify_recipients, draft_followup, review_draft_safety, archive_followup_memory)"
    );
    expect(emailReport).toContain(
      "Fixtures: 5 (thread-triage-smoke, recipient-safety-review, draft-followup-smoke, send-block-regression, archive-followup-memory)"
    );
    expect(emailReport).toContain("Report sections: 5");
    expect(emailReport).toContain("Maturity: passed (100%)");
  });
});
