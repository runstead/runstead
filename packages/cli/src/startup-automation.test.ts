import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openRunsteadDatabase } from "@runstead/state-sqlite";
import { describe, expect, it } from "vitest";

import {
  generateRepoReadinessAudit,
  generateMeasurementFramework,
  generateFounderBottleneckMap,
  generateIntegrationMap,
  generateOpsSops,
  generateSecurityBaseline,
  generateScaleOpsReport,
  generateScaleStarterPack,
  generateStartupContext,
  generateWorkflowRegistry,
  initStartup,
  captureInstitutionalMemory,
  recordSupportTriage,
  verifyGtmArtifacts
} from "./startup-automation.js";

describe("startup automation", () => {
  it("initializes startup execution and reuses an existing startup goal", async () => {
    const workspace = join(tmpdir(), `runstead-startup-init-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      const first = await initStartup({
        cwd: workspace,
        stage: "mvp",
        now: new Date("2026-05-14T02:00:00.000Z")
      });
      const second = await initStartup({
        cwd: workspace,
        stage: "mvp",
        now: new Date("2026-05-14T03:00:00.000Z")
      });

      expect(first.domainInstalled).toBe(true);
      expect(first.goalCreated).toBe(true);
      expect(first.goal).toMatchObject({
        domain: "ai-native-startup",
        title: "Build an AI-coded MVP"
      });
      expect(first.generatedTasks.map((task) => task.type)).toEqual([
        "generate_agent_context",
        "define_measurement_framework",
        "inspect_repo_readiness",
        "run_mvp_verifiers"
      ]);
      expect(second.goalCreated).toBe(false);
      expect(second.goal.id).toBe(first.goal.id);

      const database = openRunsteadDatabase(first.stateDb);

      try {
        const goalCount = database
          .prepare("SELECT COUNT(*) AS count FROM goals WHERE domain = ?")
          .get("ai-native-startup") as { count: number };

        expect(goalCount.count).toBe(1);
      } finally {
        database.close();
      }
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("generates agent context files and evidence from repo inspection", async () => {
    const workspace = join(tmpdir(), `runstead-startup-context-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      await initStartup({
        cwd: workspace,
        stage: "mvp",
        now: new Date("2026-05-14T02:00:00.000Z")
      });
      await writeFile(
        join(workspace, "package.json"),
        `${JSON.stringify(
          {
            name: "startup-context-fixture",
            private: true,
            packageManager: "pnpm@11.1.1",
            scripts: {
              test: "vitest run",
              lint: "eslint .",
              typecheck: "tsc --noEmit",
              build: "tsc -p tsconfig.build.json"
            }
          },
          null,
          2
        )}\n`,
        "utf8"
      );

      const result = await generateStartupContext({
        cwd: workspace,
        architecturePrinciples: ["Use repo-local module boundaries."],
        technicalConstraints: ["Do not edit billing code without approval."],
        acceptedDebt: ["Manual onboarding is acceptable before beta."],
        now: new Date("2026-05-14T04:00:00.000Z")
      });
      const agents = await readFile(join(workspace, "AGENTS.md"), "utf8");
      const claude = await readFile(join(workspace, "CLAUDE.md"), "utf8");
      const codex = await readFile(join(workspace, "CODEX.md"), "utf8");

      expect(result.files.map((file) => file.split("/").at(-1))).toEqual([
        "AGENTS.md",
        "CLAUDE.md",
        "CODEX.md"
      ]);
      expect(fileNames(result.structuredFiles)).toEqual([
        "AGENTS.json",
        "CLAUDE.json",
        "CODEX.json",
        "agent-context.json"
      ]);
      await expectStructuredArtifact(
        result.structuredFiles,
        "agent-context.json",
        "startup_agent_context"
      );
      expect(agents).toContain("test: pnpm test");
      expect(agents).toContain("lint: pnpm run lint");
      expect(agents).toContain("typecheck: pnpm run typecheck");
      expect(agents).toContain("build: pnpm run build");
      expect(agents).toContain("Use repo-local module boundaries.");
      expect(agents).toContain("Manual onboarding is acceptable before beta.");
      expect(claude).toContain("Startup Agent Context");
      expect(codex).toContain("Runstead is the control plane");

      const database = openRunsteadDatabase(result.stateDb);

      try {
        const evidence = database
          .prepare(
            `
            SELECT type, summary
            FROM evidence
            WHERE id = ?
          `
          )
          .get(result.evidenceId) as { type: string; summary: string } | undefined;

        expect(evidence).toEqual({
          type: "startup_agent_context",
          summary: "Generated startup agent context files"
        });
      } finally {
        database.close();
      }
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("keeps generated agent context artifacts stable when semantic inputs do not change", async () => {
    const workspace = join(
      tmpdir(),
      `runstead-startup-context-stable-${process.pid}`
    );

    try {
      await rm(workspace, { force: true, recursive: true });
      await initStartup({
        cwd: workspace,
        stage: "mvp",
        now: new Date("2026-05-14T02:00:00.000Z")
      });
      const first = await generateStartupContext({
        cwd: workspace,
        force: true,
        architecturePrinciples: ["Keep the MVP locally inspectable."],
        now: new Date("2026-05-14T04:00:00.000Z")
      });
      const agentsBefore = await readFile(join(workspace, "AGENTS.md"), "utf8");
      const firstStructured = await expectStructuredArtifact(
        first.structuredFiles,
        "AGENTS.json",
        "startup_agent_context"
      );

      const second = await generateStartupContext({
        cwd: workspace,
        force: true,
        architecturePrinciples: ["Keep the MVP locally inspectable."],
        now: new Date("2026-05-15T04:00:00.000Z")
      });
      const agentsAfter = await readFile(join(workspace, "AGENTS.md"), "utf8");
      const secondStructured = await expectStructuredArtifact(
        second.structuredFiles,
        "AGENTS.json",
        "startup_agent_context"
      );

      expect(agentsAfter).toBe(agentsBefore);
      expect(secondStructured.generatedAt).toBe(firstStructured.generatedAt);
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("refreshes current agent context without rewriting root context files", async () => {
    const workspace = join(
      tmpdir(),
      `runstead-startup-context-current-${process.pid}`
    );

    try {
      await rm(workspace, { force: true, recursive: true });
      await initStartup({
        cwd: workspace,
        stage: "mvp",
        now: new Date("2026-05-14T02:00:00.000Z")
      });

      const result = await generateStartupContext({
        cwd: workspace,
        currentOnly: true,
        now: new Date("2026-05-14T04:00:00.000Z")
      });
      const currentContext = await readFile(
        join(workspace, ".runstead", "startup", "current-agent-context.md"),
        "utf8"
      );
      const structured = await expectStructuredArtifact(
        result.structuredFiles,
        "current-agent-context.json",
        "startup_agent_context"
      );

      expect(result.files).toEqual([
        join(workspace, ".runstead", "startup", "current-agent-context.md")
      ]);
      expect(currentContext).toContain("Startup Agent Context");
      expect(structured.data).toMatchObject({
        contextFile: "current-agent-context.md",
        contextScope: "current"
      });
      await expect(readFile(join(workspace, "AGENTS.md"), "utf8")).rejects.toThrow();
      await expect(readFile(join(workspace, "CLAUDE.md"), "utf8")).rejects.toThrow();
      await expect(readFile(join(workspace, "CODEX.md"), "utf8")).rejects.toThrow();

      const database = openRunsteadDatabase(result.stateDb);

      try {
        const evidence = database
          .prepare("SELECT type, summary FROM evidence WHERE id = ?")
          .get(result.evidenceId) as { type: string; summary: string } | undefined;

        expect(evidence).toEqual({
          type: "startup_agent_context",
          summary: "Refreshed current startup agent context"
        });
      } finally {
        database.close();
      }
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("ingests existing agent context files instead of forcing overwrite", async () => {
    const workspace = join(tmpdir(), `runstead-startup-context-ingest-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      await initStartup({
        cwd: workspace,
        stage: "mvp",
        now: new Date("2026-05-14T02:00:00.000Z")
      });
      await writeFile(join(workspace, "AGENTS.md"), "# Existing AGENTS\n", "utf8");
      await writeFile(join(workspace, "CLAUDE.md"), "# Existing CLAUDE\n", "utf8");
      await writeFile(join(workspace, "CODEX.md"), "# Existing CODEX\n", "utf8");

      const result = await generateStartupContext({
        cwd: workspace,
        now: new Date("2026-05-14T04:30:00.000Z")
      });
      const agents = await readFile(join(workspace, "AGENTS.md"), "utf8");
      const structured = await expectStructuredArtifact(
        result.structuredFiles,
        "AGENTS.json",
        "startup_agent_context"
      );

      expect(agents).toBe("# Existing AGENTS\n");
      expect(structured.data).toMatchObject({
        contextFile: "AGENTS.md",
        ingested: true
      });

      const database = openRunsteadDatabase(result.stateDb);

      try {
        const evidence = database
          .prepare("SELECT type, summary FROM evidence WHERE id = ?")
          .get(result.evidenceId) as { type: string; summary: string } | undefined;

        expect(evidence).toEqual({
          type: "startup_agent_context",
          summary: "Ingested existing startup agent context files"
        });
      } finally {
        database.close();
      }
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("generates measurement framework files and evidence", async () => {
    const workspace = join(tmpdir(), `runstead-startup-measurement-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      await initStartup({
        cwd: workspace,
        stage: "mvp",
        now: new Date("2026-05-14T02:00:00.000Z")
      });

      const result = await generateMeasurementFramework({
        cwd: workspace,
        activationMetric: "User connects a source account",
        retentionMetric: "User returns to run a second readiness check",
        day7Metric: "D7 retained readiness users",
        day30Metric: "D30 retained readiness users",
        falsePositiveMetric: "Readiness pass without confirmed user value",
        now: new Date("2026-05-14T05:00:00.000Z")
      });
      const measurement = await readFile(join(workspace, "MEASUREMENT.md"), "utf8");

      expect(result.files.map((file) => file.split("/").at(-1))).toEqual([
        "MEASUREMENT.md",
        "measurement-framework.md"
      ]);
      expect(fileNames(result.structuredFiles)).toEqual([
        "MEASUREMENT.json",
        "measurement-framework.json"
      ]);
      const measurementStructured = await expectStructuredArtifact(
        result.structuredFiles,
        "measurement-framework.json",
        "startup_measurement_framework"
      );
      expect(measurementStructured.data).toMatchObject({
        activationMetric: "User connects a source account",
        retentionMetric: "User returns to run a second readiness check"
      });
      expect(measurement).toContain("User connects a source account");
      expect(measurement).toContain("D7 retained readiness users");
      expect(measurement).toContain("False-positive metric");

      const database = openRunsteadDatabase(result.stateDb);

      try {
        const evidence = database
          .prepare(
            `
            SELECT type, summary
            FROM evidence
            WHERE id = ?
          `
          )
          .get(result.evidenceId) as { type: string; summary: string } | undefined;

        expect(evidence).toEqual({
          type: "startup_measurement_framework",
          summary: "Generated startup measurement framework"
        });
      } finally {
        database.close();
      }
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("keeps generated measurement artifacts stable when semantic inputs do not change", async () => {
    const workspace = join(
      tmpdir(),
      `runstead-startup-measurement-stable-${process.pid}`
    );

    try {
      await rm(workspace, { force: true, recursive: true });
      await initStartup({
        cwd: workspace,
        stage: "mvp",
        now: new Date("2026-05-14T02:00:00.000Z")
      });
      const first = await generateMeasurementFramework({
        cwd: workspace,
        force: true,
        activationMetric: "User creates a todo",
        now: new Date("2026-05-14T05:00:00.000Z")
      });
      const measurementBefore = await readFile(
        join(workspace, "MEASUREMENT.md"),
        "utf8"
      );
      const firstStructured = await expectStructuredArtifact(
        first.structuredFiles,
        "MEASUREMENT.json",
        "startup_measurement_framework"
      );

      const second = await generateMeasurementFramework({
        cwd: workspace,
        force: true,
        activationMetric: "User creates a todo",
        now: new Date("2026-05-15T05:00:00.000Z")
      });
      const measurementAfter = await readFile(
        join(workspace, "MEASUREMENT.md"),
        "utf8"
      );
      const secondStructured = await expectStructuredArtifact(
        second.structuredFiles,
        "MEASUREMENT.json",
        "startup_measurement_framework"
      );

      expect(measurementAfter).toBe(measurementBefore);
      expect(secondStructured.generatedAt).toBe(firstStructured.generatedAt);
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("ingests an existing measurement framework instead of forcing overwrite", async () => {
    const workspace = join(
      tmpdir(),
      `runstead-startup-measurement-ingest-${process.pid}`
    );

    try {
      await rm(workspace, { force: true, recursive: true });
      await initStartup({
        cwd: workspace,
        stage: "mvp",
        now: new Date("2026-05-14T02:00:00.000Z")
      });
      await writeFile(
        join(workspace, "MEASUREMENT.md"),
        "# Existing Measurement\n\nActivation is todo created.\n",
        "utf8"
      );

      const result = await generateMeasurementFramework({
        cwd: workspace,
        now: new Date("2026-05-14T05:30:00.000Z")
      });
      const rootMeasurement = await readFile(join(workspace, "MEASUREMENT.md"), "utf8");
      const runtimeMeasurement = await readFile(
        join(workspace, ".runstead", "startup", "measurement-framework.md"),
        "utf8"
      );
      const structured = await expectStructuredArtifact(
        result.structuredFiles,
        "MEASUREMENT.json",
        "startup_measurement_framework"
      );

      expect(rootMeasurement).toBe(
        "# Existing Measurement\n\nActivation is todo created.\n"
      );
      expect(runtimeMeasurement).toBe(rootMeasurement);
      expect(structured.data).toMatchObject({
        ingested: true
      });

      const database = openRunsteadDatabase(result.stateDb);

      try {
        const evidence = database
          .prepare("SELECT type, summary FROM evidence WHERE id = ?")
          .get(result.evidenceId) as { type: string; summary: string } | undefined;

        expect(evidence).toEqual({
          type: "startup_measurement_framework",
          summary: "Ingested existing startup measurement framework"
        });
      } finally {
        database.close();
      }
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("generates launch repo readiness and security baseline evidence", async () => {
    const workspace = join(tmpdir(), `runstead-startup-launch-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      await initStartup({
        cwd: workspace,
        stage: "launch",
        now: new Date("2026-05-14T02:00:00.000Z")
      });
      await writeFile(
        join(workspace, "package.json"),
        `${JSON.stringify(
          {
            name: "startup-launch-fixture",
            private: true,
            packageManager: "pnpm@11.1.1",
            scripts: {
              test: "vitest run",
              lint: "eslint .",
              typecheck: "tsc --noEmit",
              build: "tsc -p tsconfig.build.json"
            }
          },
          null,
          2
        )}\n`,
        "utf8"
      );
      await writeFile(join(workspace, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
      await mkdir(join(workspace, ".github", "workflows"), { recursive: true });
      await writeFile(
        join(workspace, ".github", "workflows", "ci.yml"),
        "name: ci\non: [push]\njobs: {}\n",
        "utf8"
      );

      const readiness = await generateRepoReadinessAudit({
        cwd: workspace,
        now: new Date("2026-05-14T06:00:00.000Z")
      });
      const security = await generateSecurityBaseline({
        cwd: workspace,
        now: new Date("2026-05-14T06:10:00.000Z")
      });
      const readinessMarkdown = await readFile(readiness.files[0] ?? "", "utf8");
      const securityMarkdown = await readFile(security.files[0] ?? "", "utf8");

      expect(readiness.blockers).toEqual([]);
      expect(fileNames(readiness.structuredFiles)).toEqual(["repo-readiness.json"]);
      expect(fileNames(security.structuredFiles)).toEqual(["security-baseline.json"]);
      await expectStructuredArtifact(
        readiness.structuredFiles,
        "repo-readiness.json",
        "startup_repo_readiness"
      );
      await expectStructuredArtifact(
        security.structuredFiles,
        "security-baseline.json",
        "startup_security_baseline"
      );
      expect(readinessMarkdown).toContain("Startup Repository Readiness Audit");
      expect(readinessMarkdown).toContain("pnpm run typecheck");
      expect(readinessMarkdown).toContain("startup_security_baseline");
      expect(security.blockers).toEqual([]);
      expect(securityMarkdown).toContain("Startup Security Baseline");
      expect(securityMarkdown).toContain("pnpm-lock.yaml");

      const database = openRunsteadDatabase(readiness.stateDb);

      try {
        const evidence = database
          .prepare(
            `
            SELECT type, summary
            FROM evidence
            WHERE id IN (?, ?)
            ORDER BY type ASC
          `
          )
          .all(readiness.evidenceId, security.evidenceId) as {
          type: string;
          summary: string;
        }[];

        expect(evidence.map((item) => item.type)).toEqual([
          "startup_repo_readiness",
          "startup_security_baseline"
        ]);
      } finally {
        database.close();
      }
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("records launch security risk scan without leaking secret values", async () => {
    const workspace = join(tmpdir(), `runstead-startup-security-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      await initStartup({
        cwd: workspace,
        stage: "launch",
        now: new Date("2026-05-14T02:00:00.000Z")
      });
      await writeFile(
        join(workspace, "package.json"),
        `${JSON.stringify(
          {
            name: "startup-security-fixture",
            packageManager: "pnpm@11.1.1",
            dependencies: {
              stripe: "^18.0.0"
            }
          },
          null,
          2
        )}\n`,
        "utf8"
      );
      await writeFile(join(workspace, ".env.example"), "STRIPE_SECRET_KEY=\n", "utf8");
      await mkdir(join(workspace, "src"), { recursive: true });
      await writeFile(
        join(workspace, "src", "config.ts"),
        `export const stripeKey = "sk_live_1234567890abcdef";\n`,
        "utf8"
      );

      const security = await generateSecurityBaseline({
        cwd: workspace,
        now: new Date("2026-05-14T06:10:00.000Z")
      });
      const markdown = await readFile(security.files[0] ?? "", "utf8");
      const structured = await readFile(security.structuredFiles[0] ?? "", "utf8");

      expect(security.riskScan.secretFindings).toEqual([
        "src/config.ts:1 stripe_live_secret_pattern"
      ]);
      expect(security.riskScan.licenseFindings).toEqual([
        "package license is not declared for a launchable artifact"
      ]);
      expect(security.riskScan.dependencyFindings).toContain(
        "dependency lockfile is missing for reproducible launch builds"
      );
      expect(security.riskScan.thirdPartyFindings).toEqual([
        "third-party integration failure-mode evidence is missing: stripe"
      ]);
      expect(security.blockers.join("\n")).toContain(
        "potential secret exposure requires review"
      );
      expect(markdown).toContain("Launch Risk Scan");
      expect(markdown).toContain("Secret Findings");
      expect(markdown).toContain("Dependency Findings");
      expect(markdown).toContain("Third-party Integration Findings");
      expect(structured).toContain("src/config.ts:1 stripe_live_secret_pattern");
      expect(structured).not.toContain("sk_live_1234567890abcdef");
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("records support triage and founder bottleneck launch evidence", async () => {
    const workspace = join(tmpdir(), `runstead-startup-support-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      await initStartup({
        cwd: workspace,
        stage: "launch",
        now: new Date("2026-05-14T02:00:00.000Z")
      });

      const support = await recordSupportTriage({
        cwd: workspace,
        request: "Beta customer cannot complete onboarding",
        customer: "beta-co",
        severity: "high",
        outcome: "Create onboarding fix task before launch",
        sourceRefs: ["support:beta-co:001"],
        now: new Date("2026-05-14T07:00:00.000Z")
      });
      const bottleneck = await generateFounderBottleneckMap({
        cwd: workspace,
        bottlenecks: [
          "Only founder knows beta customer escalation criteria",
          "Only founder can approve launch rollback"
        ],
        owner: "ops-lead",
        systemOfRecord: "Runstead startup artifacts",
        now: new Date("2026-05-14T07:10:00.000Z")
      });
      const supportMarkdown = await readFile(support.files[0] ?? "", "utf8");
      const bottleneckMarkdown = await readFile(bottleneck.files[0] ?? "", "utf8");

      expect(fileNames(support.structuredFiles)).toEqual([
        "2026-05-14T07-00-00-000Z.json"
      ]);
      expect(fileNames(bottleneck.structuredFiles)).toEqual([
        "founder-bottlenecks.json"
      ]);
      await expectStructuredArtifact(
        support.structuredFiles,
        "2026-05-14T07-00-00-000Z.json",
        "startup_support_triage"
      );
      await expectStructuredArtifact(
        bottleneck.structuredFiles,
        "founder-bottlenecks.json",
        "startup_founder_bottleneck"
      );
      expect(supportMarkdown).toContain("Startup Support Triage");
      expect(supportMarkdown).toContain("Beta customer cannot complete onboarding");
      expect(bottleneckMarkdown).toContain("Founder Bottleneck Map");
      expect(bottleneckMarkdown).toContain(
        "Only founder knows beta customer escalation criteria"
      );

      const database = openRunsteadDatabase(support.stateDb);

      try {
        const evidence = database
          .prepare(
            `
            SELECT type
            FROM evidence
            WHERE id IN (?, ?)
            ORDER BY type ASC
          `
          )
          .all(support.evidenceId, bottleneck.evidenceId) as { type: string }[];

        expect(evidence.map((item) => item.type)).toEqual([
          "startup_founder_bottleneck",
          "startup_support_triage"
        ]);
      } finally {
        database.close();
      }
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("generates workflow registry and delegation policy evidence", async () => {
    const workspace = join(tmpdir(), `runstead-startup-workflow-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      await initStartup({
        cwd: workspace,
        stage: "scale",
        now: new Date("2026-05-14T02:00:00.000Z")
      });

      const result = await generateWorkflowRegistry({
        cwd: workspace,
        workflows: [
          "Weekly launch readiness report",
          "Support triage to remediation task"
        ],
        delegationRules: [
          "Codex may draft reports from evidence",
          "Publishing requires founder approval"
        ],
        approvalBoundaries: ["publish", "protected_path"],
        now: new Date("2026-05-14T08:00:00.000Z")
      });
      const workflowMarkdown = await readFile(result.files[0] ?? "", "utf8");
      const delegationMarkdown = await readFile(result.files[1] ?? "", "utf8");

      expect(fileNames(result.structuredFiles)).toEqual([
        "workflow-registry.json",
        "delegation-policy.json"
      ]);
      await expectStructuredArtifact(
        result.structuredFiles,
        "workflow-registry.json",
        "startup_workflow_registry"
      );
      await expectStructuredArtifact(
        result.structuredFiles,
        "delegation-policy.json",
        "startup_delegation_policy"
      );
      expect(workflowMarkdown).toContain("Startup Workflow Registry");
      expect(workflowMarkdown).toContain("Weekly launch readiness report");
      expect(delegationMarkdown).toContain("Startup Delegation Policy");
      expect(delegationMarkdown).toContain("Publishing requires founder approval");

      const database = openRunsteadDatabase(result.stateDb);
      const [workflowEvidenceId, delegationEvidenceId] = result.evidenceIds;

      if (workflowEvidenceId === undefined || delegationEvidenceId === undefined) {
        throw new Error("Expected workflow and delegation evidence ids");
      }

      try {
        const evidence = database
          .prepare(
            `
            SELECT type
            FROM evidence
            WHERE id IN (?, ?)
            ORDER BY type ASC
          `
          )
          .all(workflowEvidenceId, delegationEvidenceId) as { type: string }[];

        expect(evidence.map((item) => item.type)).toEqual([
          "startup_delegation_policy",
          "startup_workflow_registry"
        ]);
      } finally {
        database.close();
      }
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("captures institutional memory and integration depth evidence", async () => {
    const workspace = join(tmpdir(), `runstead-startup-memory-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      await initStartup({
        cwd: workspace,
        stage: "scale",
        now: new Date("2026-05-14T02:00:00.000Z")
      });

      const memory = await captureInstitutionalMemory({
        cwd: workspace,
        knowledge: [
          "Enterprise beta onboarding depends on the founder's manual data review"
        ],
        sourceRefs: ["founder-notes:scale"],
        now: new Date("2026-05-14T09:00:00.000Z")
      });
      const integration = await generateIntegrationMap({
        cwd: workspace,
        integrations: ["CRM account sync", "Support inbox triage"],
        lockInSignals: ["Customer runs launch checks inside support workflow"],
        automationCoverage: ["CRM sync is manual; support triage is agent-assisted"],
        now: new Date("2026-05-14T09:10:00.000Z")
      });
      const memoryMarkdown = await readFile(memory.files[0] ?? "", "utf8");
      const integrationMarkdown = await readFile(integration.files[0] ?? "", "utf8");

      expect(fileNames(memory.structuredFiles)).toEqual(["institutional-memory.json"]);
      expect(fileNames(integration.structuredFiles)).toEqual([
        "integration-depth-map.json"
      ]);
      await expectStructuredArtifact(
        memory.structuredFiles,
        "institutional-memory.json",
        "startup_institutional_memory"
      );
      await expectStructuredArtifact(
        integration.structuredFiles,
        "integration-depth-map.json",
        "startup_integration_map"
      );
      expect(memoryMarkdown).toContain("Startup Institutional Memory");
      expect(memoryMarkdown).toContain("manual data review");
      expect(integrationMarkdown).toContain("Startup Integration Depth Map");
      expect(integrationMarkdown).toContain("CRM account sync");

      const database = openRunsteadDatabase(memory.stateDb);

      try {
        const fact = database
          .prepare(
            `
            SELECT type, status, content
            FROM memory_records
            WHERE id = ?
          `
          )
          .get(memory.memoryId) as
          | { type: string; status: string; content: string }
          | undefined;
        const evidence = database
          .prepare(
            `
            SELECT type
            FROM evidence
            WHERE id IN (?, ?)
            ORDER BY type ASC
          `
          )
          .all(memory.evidenceId, integration.evidenceId) as { type: string }[];

        expect(fact).toMatchObject({
          type: "project_fact",
          status: "verified"
        });
        expect(fact?.content).toContain("manual data review");
        expect(evidence.map((item) => item.type)).toEqual([
          "startup_institutional_memory",
          "startup_integration_map"
        ]);
      } finally {
        database.close();
      }
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("generates recurring scale reports, SOPs, and GTM verification evidence", async () => {
    const workspace = join(tmpdir(), `runstead-startup-scale-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      await initStartup({
        cwd: workspace,
        stage: "scale",
        now: new Date("2026-05-14T02:00:00.000Z")
      });
      await recordSupportTriage({
        cwd: workspace,
        request: "Customer needs weekly readiness summary",
        outcome: "Track in weekly scale report",
        now: new Date("2026-05-14T09:30:00.000Z")
      });

      const sops = await generateOpsSops({
        cwd: workspace,
        sops: ["Every Monday, generate startup scale report from evidence"],
        owner: "ops-lead",
        workflow: "weekly ops review",
        now: new Date("2026-05-14T10:00:00.000Z")
      });
      const gtm = await verifyGtmArtifacts({
        cwd: workspace,
        claims: ["Runstead produces evidence-backed launch readiness reports"],
        evidenceRefs: ["startup:launch-readiness"],
        productState: "report command available",
        now: new Date("2026-05-14T10:10:00.000Z")
      });
      const report = await generateScaleOpsReport({
        cwd: workspace,
        period: "2026-W20",
        now: new Date("2026-05-14T10:20:00.000Z")
      });
      const sopsMarkdown = await readFile(sops.files[0] ?? "", "utf8");
      const gtmMarkdown = await readFile(gtm.files[0] ?? "", "utf8");
      const reportMarkdown = await readFile(report.files[0] ?? "", "utf8");

      expect(fileNames(sops.structuredFiles)).toEqual(["ops-sops.json"]);
      expect(fileNames(gtm.structuredFiles)).toEqual(["gtm-artifacts.json"]);
      expect(fileNames(report.structuredFiles)).toEqual(["startup-ops-2026-W20.json"]);
      await expectStructuredArtifact(
        sops.structuredFiles,
        "ops-sops.json",
        "startup_ops_sop"
      );
      await expectStructuredArtifact(
        gtm.structuredFiles,
        "gtm-artifacts.json",
        "startup_gtm_artifact"
      );
      await expectStructuredArtifact(
        report.structuredFiles,
        "startup-ops-2026-W20.json",
        "startup_ops_report"
      );
      expect(sopsMarkdown).toContain("Startup Ops SOPs");
      expect(sopsMarkdown).toContain("weekly ops review");
      expect(gtmMarkdown).toContain("Startup GTM Artifact Verification");
      expect(gtmMarkdown).toContain("evidence-backed launch readiness");
      expect(reportMarkdown).toContain("Startup Scale Ops Report");
      expect(reportMarkdown).toContain("## Scale Gate Blockers");
      expect(reportMarkdown).toContain("Weekly Engineering Evidence");
      expect(report.period).toBe("2026-W20");

      const database = openRunsteadDatabase(report.stateDb);

      try {
        const evidence = database
          .prepare(
            `
            SELECT type
            FROM evidence
            WHERE id IN (?, ?, ?)
            ORDER BY type ASC
          `
          )
          .all(sops.evidenceId, gtm.evidenceId, report.evidenceId) as {
          type: string;
        }[];

        expect(evidence.map((item) => item.type)).toEqual([
          "startup_gtm_artifact",
          "startup_ops_report",
          "startup_ops_sop"
        ]);
      } finally {
        database.close();
      }
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("generates a scale starter pack without granting scale-ready status", async () => {
    const workspace = join(tmpdir(), `runstead-startup-scale-starter-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      await initStartup({
        cwd: workspace,
        stage: "scale",
        now: new Date("2026-05-14T10:00:00.000Z")
      });

      const result = await generateScaleStarterPack({
        cwd: workspace,
        owner: "founder",
        now: new Date("2026-05-14T10:30:00.000Z")
      });
      const summary = await readFile(result.files[0] ?? "", "utf8");
      const database = openRunsteadDatabase(result.stateDb);

      try {
        const evidenceTypes = (
          database
            .prepare(
              `
              SELECT DISTINCT type
              FROM evidence
              WHERE id IN (${result.evidenceIds.map(() => "?").join(",")})
              ORDER BY type ASC
            `
            )
            .all(...result.evidenceIds) as { type: string }[]
        ).map((row) => row.type);

        expect(result.scaleReady).toBe(false);
        expect(result.files.map((file) => file.split("/").at(-1))).toEqual(
          expect.arrayContaining([
            "scale-starter-pack.md",
            "workflow-registry.md",
            "delegation-policy.md",
            "scale-report-schedule.md",
            "ops-sops.md",
            "gtm-artifacts.md"
          ])
        );
        expect(result.structuredFiles.map((file) => file.split("/").at(-1))).toEqual(
          expect.arrayContaining(["scale-starter-pack.json"])
        );
        expect(evidenceTypes).toEqual(
          expect.arrayContaining([
            "startup_scale_starter_pack",
            "startup_workflow_registry",
            "startup_delegation_policy",
            "startup_support_triage",
            "startup_ops_schedule",
            "startup_ops_sop",
            "startup_gtm_artifact"
          ])
        );
        expect(summary).toContain("Scale-ready: false");
        expect(summary).toContain("This pack creates operating templates");
        expect(result.nextCommands).toContain("runstead startup scale-check");
      } finally {
        database.close();
      }
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});

interface StructuredArtifactFixture {
  schemaVersion: number;
  schema: string;
  kind: string;
  generatedAt: string;
  markdownPath: string;
  data: Record<string, unknown>;
}

function fileNames(files: string[]): string[] {
  return files.map((file) => file.split("/").at(-1) ?? file);
}

async function expectStructuredArtifact(
  files: string[],
  filename: string,
  kind: string
): Promise<StructuredArtifactFixture> {
  const path = files.find((file) => file.endsWith(`/${filename}`));

  if (path === undefined) {
    throw new Error(`Expected structured artifact ${filename}`);
  }

  const artifact = JSON.parse(
    await readFile(path, "utf8")
  ) as StructuredArtifactFixture;

  expect(artifact).toMatchObject({
    schemaVersion: 1,
    schema: "runstead.startupArtifact",
    kind
  });
  expect(artifact.markdownPath.endsWith(".md")).toBe(true);

  return artifact;
}
