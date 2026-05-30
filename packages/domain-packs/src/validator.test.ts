import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  formatDomainPackValidationResult,
  validateDomainPackDir
} from "./validator.js";
import { createDomainPackTemplate } from "./template.js";

describe("validateDomainPackDir", () => {
  it("validates the built-in repo-maintenance pack", async () => {
    const packRoot = fileURLToPath(
      new URL("../packs/repo-maintenance", import.meta.url)
    );

    const result = await validateDomainPackDir(packRoot);

    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.domain?.id).toBe("repo-maintenance");
    expect(result.goalTemplates.map((template) => template.id)).toEqual([
      "keep-ci-green"
    ]);
    expect(result.taskTypes.map((taskType) => taskType.id)).toEqual([
      "repo_inspect",
      "run_local_verifiers",
      "ci_repair"
    ]);
    expect(result.fixtures.map((fixture) => fixture.id)).toEqual(["js-test-failure"]);
    expect(result.evals.map((evaluation) => evaluation.id)).toEqual([
      "js-test-failure-smoke"
    ]);
    expect(formatDomainPackValidationResult(result)).toContain("Status: valid");
    expect(formatDomainPackValidationResult(result)).toContain("Fixtures: 1");
  });

  it("validates the experimental ai-native-startup MVP pack", async () => {
    const packRoot = fileURLToPath(
      new URL("../packs/ai-native-startup", import.meta.url)
    );

    const result = await validateDomainPackDir(packRoot);

    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.domain?.id).toBe("ai-native-startup");
    expect(result.goalTemplates.map((template) => template.id)).toEqual([
      "validate-problem",
      "build-mvp",
      "scale-ops"
    ]);
    expect(result.taskTypes.map((taskType) => taskType.id)).toEqual([
      "collect_customer_evidence",
      "check_disconfirming_evidence",
      "run_build_gate",
      "generate_agent_context",
      "define_measurement_framework",
      "inspect_repo_readiness",
      "run_mvp_verifiers",
      "map_founder_bottlenecks",
      "register_workflow_automation",
      "generate_ops_sops",
      "triage_support_evidence",
      "verify_gtm_artifacts"
    ]);
    expect(result.fixtures.map((fixture) => fixture.id)).toEqual([
      "tiny-todo",
      "validation-ledger-smoke",
      "ai-coded-mvp-smoke",
      "ops-handoff-smoke",
      "dogfood-saas",
      "todo-dogfood-regression",
      "broken-launch-repo",
      "existing-mature-repo",
      "security-review-gate",
      "customer-support-workflow",
      "data-migration-readiness"
    ]);
    expect(result.evals.map((evaluation) => evaluation.id)).toEqual([
      "tiny-todo",
      "validation-ledger-smoke",
      "ai-coded-mvp-smoke",
      "ops-handoff-smoke",
      "dogfood-saas",
      "todo-dogfood-regression",
      "broken-launch-repo",
      "existing-mature-repo",
      "security-review-gate",
      "customer-support-workflow",
      "data-migration-readiness"
    ]);
    expect(result.domain?.schemaVersion).toBe(1);
    expect(result.domain?.repoTemplates?.map((template) => template.id)).toEqual([
      "saas",
      "chrome-extension",
      "api-service",
      "landing-waitlist"
    ]);
    expect(Object.keys(result.domain?.gateThresholds ?? {})).toEqual([
      "mvp",
      "launch",
      "scale"
    ]);
    expect(result.domain?.reportSections?.map((section) => section.id)).toEqual([
      "repo-readiness",
      "measurement",
      "security-launch-risk"
    ]);
    expect(
      result.goalTemplates.find((template) => template.id === "build-mvp")?.generated
        .acceptanceContracts
    ).toContain("measurement_framework_defined");
  });

  it("validates the experimental research-monitor pack", async () => {
    const packRoot = fileURLToPath(
      new URL("../packs/research-monitor", import.meta.url)
    );

    const result = await validateDomainPackDir(packRoot);

    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.domain?.id).toBe("research-monitor");
    expect(result.domain?.schemaVersion).toBe(1);
    expect(result.domain?.repoTemplates?.map((template) => template.id)).toEqual([
      "literature-watch",
      "market-intel",
      "policy-regulatory"
    ]);
    expect(Object.keys(result.domain?.gateThresholds ?? {})).toEqual([
      "scan",
      "assess",
      "digest",
      "publish",
      "archive"
    ]);
    expect(result.goalTemplates.map((template) => template.id)).toEqual([
      "weekly-research-digest"
    ]);
    expect(result.taskTypes.map((taskType) => taskType.id)).toEqual([
      "discover_sources",
      "scan_sources",
      "evaluate_source_reliability",
      "summarize_findings",
      "triage_source_conflicts",
      "prepare_digest_release",
      "archive_research_memory"
    ]);
    expect(result.fixtures.map((fixture) => fixture.id)).toEqual([
      "source-discovery-review",
      "source-reliability-review",
      "weekly-research-digest-smoke",
      "conflicting-sources-regression",
      "publish-gate-review",
      "archive-memory-update"
    ]);
    expect(result.evals.map((evaluation) => evaluation.id)).toEqual([
      "source-discovery-review",
      "source-reliability-review",
      "weekly-research-digest-smoke",
      "conflicting-sources-regression",
      "publish-gate-review",
      "archive-memory-update"
    ]);
    expect(result.domain?.reportSections?.map((section) => section.id)).toEqual([
      "source-coverage",
      "source-reliability",
      "claim-quality",
      "distribution-readiness",
      "research-memory"
    ]);
    expect(result.goalTemplates[0]?.generated.recurringTasks).toEqual([
      "discover_sources",
      "scan_sources",
      "evaluate_source_reliability",
      "summarize_findings",
      "triage_source_conflicts",
      "prepare_digest_release",
      "archive_research_memory"
    ]);
  });

  it("validates the experimental email-followup draft-only pack", async () => {
    const packRoot = fileURLToPath(new URL("../packs/email-followup", import.meta.url));

    const result = await validateDomainPackDir(packRoot);

    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.domain?.id).toBe("email-followup");
    expect(result.domain?.schemaVersion).toBe(1);
    expect(result.domain?.repoTemplates?.map((template) => template.id)).toEqual([
      "founder-inbox",
      "support-followups",
      "sales-nurture"
    ]);
    expect(Object.keys(result.domain?.gateThresholds ?? {})).toEqual([
      "scan",
      "draft",
      "send-approval",
      "memory"
    ]);
    expect(result.goalTemplates.map((template) => template.id)).toEqual([
      "draft-pending-followups"
    ]);
    expect(result.taskTypes.map((taskType) => taskType.id)).toEqual([
      "scan_threads",
      "classify_followup_need",
      "verify_recipients",
      "draft_followup",
      "review_draft_safety",
      "archive_followup_memory"
    ]);
    expect(result.goalTemplates[0]?.generated.recurringTasks).toEqual([
      "scan_threads",
      "classify_followup_need",
      "verify_recipients",
      "draft_followup",
      "review_draft_safety",
      "archive_followup_memory"
    ]);
    expect(result.goalTemplates[0]?.generated.acceptanceContracts).toContain(
      "send_not_performed"
    );
    expect(result.fixtures.map((fixture) => fixture.id)).toEqual([
      "thread-triage-smoke",
      "recipient-safety-review",
      "draft-followup-smoke",
      "send-block-regression",
      "archive-followup-memory"
    ]);
    expect(result.evals.map((evaluation) => evaluation.id)).toEqual([
      "thread-triage-smoke",
      "recipient-safety-review",
      "draft-followup-smoke",
      "send-block-regression",
      "archive-followup-memory"
    ]);
    expect(result.domain?.reportSections?.map((section) => section.id)).toEqual([
      "thread-triage",
      "recipient-safety",
      "draft-quality",
      "send-boundary",
      "followup-memory"
    ]);
  });

  it("validates fixture manifests and eval benchmarks", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-domain-pack-"));

    try {
      await mkdir(join(workspace, "evals"), { recursive: true });
      await mkdir(join(workspace, "fixtures", "manual-review-smoke"), {
        recursive: true
      });
      await mkdir(join(workspace, "goal-templates"), { recursive: true });
      await mkdir(join(workspace, "policies"), { recursive: true });
      await mkdir(join(workspace, "task-types"), { recursive: true });
      await writeFile(
        join(workspace, "domain.yaml"),
        [
          "id: custom-pack",
          "version: 0.1.0",
          "name: Custom Pack",
          "description: Fixture test pack.",
          "compatibility:",
          "  runstead_min_version: 0.0.0",
          "goal_templates:",
          "  - default-goal",
          "task_types:",
          "  - manual_review",
          "default_policy: policies/default.yaml",
          "default_verifiers:",
          "  - manual_review",
          "required_tools:",
          "  - filesystem",
          "supported_workers:",
          "  - shell"
        ].join("\n"),
        "utf8"
      );
      await writeFile(
        join(workspace, "goal-templates", "default-goal.yaml"),
        [
          "id: default-goal",
          "domain: custom-pack",
          "title: Default Goal",
          "description: Fixture validation goal.",
          "generated:",
          "  recurring_tasks:",
          "    - manual_review",
          "  acceptance_contracts:",
          "    - manual_review_complete"
        ].join("\n"),
        "utf8"
      );
      await writeFile(
        join(workspace, "task-types", "manual_review.yaml"),
        [
          "id: manual_review",
          "domain: custom-pack",
          "description: Manual review task.",
          "default_priority: medium",
          "max_attempts: 1",
          "verifiers:",
          "  required:",
          "    - manual_review:evidence_attached",
          "worker_routing:",
          "  preferred: shell"
        ].join("\n"),
        "utf8"
      );
      await writeFile(
        join(workspace, "policies", "default.yaml"),
        [
          "id: policy_custom_pack_v1",
          "version: 1",
          "default_decision: require_approval",
          "default_risk: medium",
          "rules: []"
        ].join("\n"),
        "utf8"
      );
      await writeFile(
        join(workspace, "fixtures", "manifest.yaml"),
        [
          "version: 1",
          "fixtures:",
          "  - id: manual-review-smoke",
          "    description: Manual review smoke fixture.",
          "    path: manual-review-smoke",
          "    task_type: manual_review",
          "    goal_template: default-goal",
          "    tags:",
          "      - smoke",
          "    acceptance_contracts:",
          "      - manual_review_complete"
        ].join("\n"),
        "utf8"
      );
      await writeFile(
        join(workspace, "evals", "benchmark.yaml"),
        [
          "version: 1",
          "benchmarks:",
          "  - id: manual-review-smoke",
          "    fixture: manual-review-smoke",
          "    acceptance_contracts:",
          "      - manual_review_complete"
        ].join("\n"),
        "utf8"
      );

      const result = await validateDomainPackDir(workspace);

      expect(result.valid).toBe(true);
      expect(result.fixtures).toEqual([
        {
          id: "manual-review-smoke",
          description: "Manual review smoke fixture.",
          path: "manual-review-smoke",
          taskType: "manual_review",
          goalTemplate: "default-goal",
          tags: ["smoke"],
          acceptanceContracts: ["manual_review_complete"]
        }
      ]);
      expect(result.evals).toEqual([
        {
          id: "manual-review-smoke",
          fixture: "manual-review-smoke",
          acceptanceContracts: ["manual_review_complete"]
        }
      ]);
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("rejects symlinks in manifest-controlled pack references", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-domain-pack-"));

    try {
      const template = await createDomainPackTemplate({
        id: "symlink-pack",
        outputDir: join(workspace, "pack")
      });
      const policyPath = join(template.root, "policies", "default.yaml");
      const fixturePath = join(template.root, "fixtures", "manual-review-smoke");
      const outsidePolicy = join(workspace, "outside-policy.yaml");
      const outsideFixture = join(workspace, "outside-fixture");

      await writeFile(
        outsidePolicy,
        [
          "id: policy_symlink_pack_default_v1",
          "version: 1",
          "default_decision: require_approval",
          "default_risk: medium",
          "rules: []"
        ].join("\n"),
        "utf8"
      );
      await mkdir(outsideFixture, { recursive: true });
      await writeFile(join(outsideFixture, "README.md"), "# Outside fixture\n", "utf8");
      await rm(policyPath, { force: true });
      await rm(fixturePath, { force: true, recursive: true });
      await symlink(outsidePolicy, policyPath);
      await symlink(outsideFixture, fixturePath);

      const result = await validateDomainPackDir(template.root);

      expect(result.valid).toBe(false);
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "default_policy_symlink",
            path: "policies/default.yaml"
          }),
          expect.objectContaining({
            code: "fixture_path_symlink",
            path: "fixtures/manual-review-smoke"
          })
        ])
      );
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("reports inconsistent fixture and eval manifests", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-domain-pack-"));

    try {
      await mkdir(join(workspace, "evals"), { recursive: true });
      await mkdir(join(workspace, "fixtures", "stray-fixture"), {
        recursive: true
      });
      await mkdir(join(workspace, "policies"), { recursive: true });
      await writeFile(
        join(workspace, "domain.yaml"),
        [
          "id: custom-pack",
          "version: 0.1.0",
          "name: Custom Pack",
          "description: Invalid fixture test pack.",
          "compatibility:",
          "  runstead_min_version: 0.0.0",
          "goal_templates: []",
          "task_types: []",
          "default_policy: policies/default.yaml",
          "default_verifiers: []",
          "required_tools: []",
          "supported_workers: []"
        ].join("\n"),
        "utf8"
      );
      await writeFile(
        join(workspace, "policies", "default.yaml"),
        [
          "id: policy_custom_pack_v1",
          "version: 1",
          "default_decision: require_approval",
          "default_risk: medium",
          "rules: []"
        ].join("\n"),
        "utf8"
      );
      await writeFile(
        join(workspace, "fixtures", "manifest.yaml"),
        [
          "version: 1",
          "fixtures:",
          "  - id: broken-fixture",
          "    description: Bad fixture.",
          "    path: ../outside",
          "    task_type: missing_task",
          "    goal_template: missing-goal",
          "  - id: repeated-fixture",
          "    description: Duplicate fixture.",
          "    task_type: missing_task",
          "  - id: repeated-fixture",
          "    description: Duplicate fixture again.",
          "    task_type: missing_task"
        ].join("\n"),
        "utf8"
      );
      await writeFile(
        join(workspace, "evals", "benchmark.yaml"),
        [
          "version: 1",
          "benchmarks:",
          "  - id: repeated-eval",
          "    fixture: missing-fixture",
          "    acceptance_contracts:",
          "      - manual_review_complete",
          "  - id: repeated-eval",
          "    fixture: missing-fixture",
          "    acceptance_contracts:",
          "      - manual_review_complete"
        ].join("\n"),
        "utf8"
      );

      const result = await validateDomainPackDir(workspace);

      expect(result.valid).toBe(false);
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "fixture_duplicate_id" }),
          expect.objectContaining({ code: "fixture_task_type_unknown" }),
          expect.objectContaining({ code: "fixture_goal_template_unknown" }),
          expect.objectContaining({ code: "fixture_path_escapes_pack" }),
          expect.objectContaining({ code: "fixture_path_missing" }),
          expect.objectContaining({ code: "fixture_unregistered_directory" }),
          expect.objectContaining({ code: "eval_duplicate_id" }),
          expect.objectContaining({ code: "eval_fixture_unknown" })
        ])
      );
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("reports missing and mismatched pack references", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-domain-pack-"));

    try {
      await mkdir(join(workspace, "goal-templates"), { recursive: true });
      await mkdir(join(workspace, "task-types"), { recursive: true });
      await writeFile(
        join(workspace, "domain.yaml"),
        [
          "id: custom-pack",
          "version: 0.1.0",
          "name: Custom Pack",
          "description: Invalid test pack.",
          "compatibility:",
          "  runstead_min_version: 0.0.0",
          "goal_templates:",
          "  - missing-template",
          "  - wrong-template",
          "task_types:",
          "  - missing_task",
          "  - wrong_task",
          "default_policy: policies/missing.yaml",
          "default_verifiers:",
          "  - command",
          "required_tools:",
          "  - shell",
          "supported_workers:",
          "  - shell"
        ].join("\n"),
        "utf8"
      );
      await writeFile(
        join(workspace, "goal-templates", "wrong-template.yaml"),
        [
          "id: other-template",
          "domain: other-pack",
          "title: Wrong Template",
          "description: Wrong domain.",
          "generated:",
          "  recurring_tasks: []",
          "  acceptance_contracts: []"
        ].join("\n"),
        "utf8"
      );
      await writeFile(
        join(workspace, "task-types", "wrong_task.yaml"),
        [
          "id: other_task",
          "domain: other-pack",
          "description: Wrong task type.",
          "default_priority: medium",
          "max_attempts: 1",
          "verifiers:",
          "  required:",
          "    - command:test",
          "worker_routing:",
          "  preferred: shell"
        ].join("\n"),
        "utf8"
      );

      const result = await validateDomainPackDir(workspace);

      expect(result.valid).toBe(false);
      expect(result.issues.map((issue) => issue.code)).toEqual(
        expect.arrayContaining([
          "goal_template_missing",
          "goal_template_id_mismatch",
          "goal_template_domain_mismatch",
          "task_type_missing",
          "task_type_id_mismatch",
          "task_type_domain_mismatch",
          "default_policy_missing"
        ])
      );
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("rejects unstable domain pack ids and versions", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-domain-pack-"));

    try {
      await writeFile(
        join(workspace, "domain.yaml"),
        [
          "id: Custom_Pack",
          "version: latest",
          "name: Custom Pack",
          "description: Invalid versioning test pack.",
          "compatibility:",
          "  runstead_min_version: 0.0.0",
          "goal_templates: []",
          "task_types: []",
          "default_policy: policies/default.yaml",
          "default_verifiers: []",
          "required_tools: []",
          "supported_workers: []"
        ].join("\n"),
        "utf8"
      );

      const result = await validateDomainPackDir(workspace);

      expect(result.valid).toBe(false);
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            severity: "error",
            code: "domain_yaml_invalid"
          })
        ])
      );
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("rejects invalid default policy yaml", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-domain-pack-"));

    try {
      await mkdir(join(workspace, "policies"), { recursive: true });
      await writeFile(
        join(workspace, "domain.yaml"),
        [
          "id: custom-pack",
          "version: 0.1.0",
          "name: Custom Pack",
          "description: Invalid policy test pack.",
          "compatibility:",
          "  runstead_min_version: 0.0.0",
          "goal_templates: []",
          "task_types: []",
          "default_policy: policies/default.yaml",
          "default_verifiers: []",
          "required_tools: []",
          "supported_workers: []"
        ].join("\n"),
        "utf8"
      );
      await writeFile(
        join(workspace, "policies", "default.yaml"),
        [
          "id: policy_custom_pack_v1",
          "version: 1",
          "rules:",
          "  - id: invalid_decision",
          "    decision: maybe"
        ].join("\n"),
        "utf8"
      );

      const result = await validateDomainPackDir(workspace);

      expect(result.valid).toBe(false);
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            severity: "error",
            code: "default_policy_invalid"
          })
        ])
      );
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("requires explicit default policy decisions and risk", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-domain-pack-"));

    try {
      await mkdir(join(workspace, "policies"), { recursive: true });
      await writeFile(
        join(workspace, "domain.yaml"),
        [
          "id: custom-pack",
          "version: 0.1.0",
          "name: Custom Pack",
          "description: Missing policy defaults test pack.",
          "compatibility:",
          "  runstead_min_version: 0.0.0",
          "goal_templates: []",
          "task_types: []",
          "default_policy: policies/default.yaml",
          "default_verifiers: []",
          "required_tools: []",
          "supported_workers: []"
        ].join("\n"),
        "utf8"
      );
      await writeFile(
        join(workspace, "policies", "default.yaml"),
        [
          "id: policy_custom_pack_v1",
          "version: 1",
          "rules:",
          "  - id: allow_evidence_collection",
          "    decision: allow",
          "    risk: low"
        ].join("\n"),
        "utf8"
      );

      const result = await validateDomainPackDir(workspace);

      expect(result.valid).toBe(false);
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            severity: "error",
            code: "default_policy_default_decision_missing"
          }),
          expect.objectContaining({
            severity: "error",
            code: "default_policy_default_risk_missing"
          })
        ])
      );
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("rejects duplicate default policy rule ids", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-domain-pack-"));

    try {
      await mkdir(join(workspace, "policies"), { recursive: true });
      await writeFile(
        join(workspace, "domain.yaml"),
        [
          "id: custom-pack",
          "version: 0.1.0",
          "name: Custom Pack",
          "description: Duplicate policy rule test pack.",
          "compatibility:",
          "  runstead_min_version: 0.0.0",
          "goal_templates: []",
          "task_types: []",
          "default_policy: policies/default.yaml",
          "default_verifiers: []",
          "required_tools: []",
          "supported_workers: []"
        ].join("\n"),
        "utf8"
      );
      await writeFile(
        join(workspace, "policies", "default.yaml"),
        [
          "id: policy_custom_pack_v1",
          "version: 1",
          "rules:",
          "  - id: repeated_rule",
          "    decision: allow",
          "  - id: repeated_rule",
          "    decision: deny"
        ].join("\n"),
        "utf8"
      );

      const result = await validateDomainPackDir(workspace);

      expect(result.valid).toBe(false);
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            severity: "error",
            code: "default_policy_rule_duplicate_id"
          })
        ])
      );
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("reports unregistered task yaml and undeclared worker routing", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-domain-pack-"));

    try {
      await mkdir(join(workspace, "policies"), { recursive: true });
      await mkdir(join(workspace, "task-types"), { recursive: true });
      await writeFile(
        join(workspace, "domain.yaml"),
        [
          "id: custom-pack",
          "version: 0.1.0",
          "name: Custom Pack",
          "description: Invalid worker routing test pack.",
          "compatibility:",
          "  runstead_min_version: 0.0.0",
          "goal_templates: []",
          "task_types:",
          "  - registered_task",
          "default_policy: policies/default.yaml",
          "default_verifiers:",
          "  - command",
          "required_tools:",
          "  - shell",
          "supported_workers:",
          "  - shell"
        ].join("\n"),
        "utf8"
      );
      await writeFile(
        join(workspace, "policies", "default.yaml"),
        "rules: []\n",
        "utf8"
      );
      await writeFile(
        join(workspace, "task-types", "registered_task.yaml"),
        [
          "id: registered_task",
          "domain: custom-pack",
          "description: Registered task with bad worker.",
          "default_priority: medium",
          "max_attempts: 1",
          "verifiers:",
          "  required:",
          "    - command:test",
          "worker_routing:",
          "  preferred: codex_cli"
        ].join("\n"),
        "utf8"
      );
      await writeFile(
        join(workspace, "task-types", "extra_task.yaml"),
        [
          "id: extra_task",
          "domain: custom-pack",
          "description: Unregistered task.",
          "default_priority: medium",
          "max_attempts: 1",
          "verifiers:",
          "  required:",
          "    - command:test",
          "worker_routing:",
          "  preferred: shell"
        ].join("\n"),
        "utf8"
      );

      const result = await validateDomainPackDir(workspace);

      expect(result.valid).toBe(false);
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            severity: "error",
            code: "task_type_worker_undeclared"
          }),
          expect.objectContaining({
            severity: "warning",
            code: "task_type_unregistered_yaml"
          })
        ])
      );
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("rejects goal templates that schedule undeclared task types", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-domain-pack-"));

    try {
      await mkdir(join(workspace, "goal-templates"), { recursive: true });
      await mkdir(join(workspace, "policies"), { recursive: true });
      await mkdir(join(workspace, "task-types"), { recursive: true });
      await writeFile(
        join(workspace, "domain.yaml"),
        [
          "id: custom-pack",
          "version: 0.1.0",
          "name: Custom Pack",
          "description: Invalid goal template recurring task test pack.",
          "compatibility:",
          "  runstead_min_version: 0.0.0",
          "goal_templates:",
          "  - keep-fresh",
          "task_types:",
          "  - known_task",
          "default_policy: policies/default.yaml",
          "default_verifiers:",
          "  - command",
          "required_tools:",
          "  - shell",
          "supported_workers:",
          "  - shell"
        ].join("\n"),
        "utf8"
      );
      await writeFile(
        join(workspace, "policies", "default.yaml"),
        "rules: []\n",
        "utf8"
      );
      await writeFile(
        join(workspace, "goal-templates", "keep-fresh.yaml"),
        [
          "id: keep-fresh",
          "domain: custom-pack",
          "title: Keep Fresh",
          "description: Schedules an undeclared task.",
          "generated:",
          "  recurring_tasks:",
          "    - missing_task",
          "  acceptance_contracts: []"
        ].join("\n"),
        "utf8"
      );
      await writeFile(
        join(workspace, "task-types", "known_task.yaml"),
        [
          "id: known_task",
          "domain: custom-pack",
          "description: Known task.",
          "default_priority: medium",
          "max_attempts: 1",
          "verifiers:",
          "  required:",
          "    - command:test",
          "worker_routing:",
          "  preferred: shell"
        ].join("\n"),
        "utf8"
      );

      const result = await validateDomainPackDir(workspace);

      expect(result.valid).toBe(false);
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            severity: "error",
            code: "goal_template_recurring_task_unknown"
          })
        ])
      );
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("rejects evidence contracts that reference unknown workflows", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-domain-pack-"));

    try {
      const result = await createDomainPackTemplate({
        id: "customer-ops",
        outputDir: join(workspace, "customer-ops")
      });
      const domainPath = join(result.root, "domain.yaml");
      const domainYaml = await readFile(domainPath, "utf8");

      await writeFile(
        domainPath,
        domainYaml.replace("workflow: default-goal", "workflow: missing-workflow"),
        "utf8"
      );

      const validation = await validateDomainPackDir(result.root);

      expect(validation.valid).toBe(false);
      expect(validation.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            severity: "error",
            code: "evidence_contract_unknown_workflow"
          })
        ])
      );
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});
