import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import { createProgram } from "./index.js";
import { listTasks } from "./tasks.js";

const fixturesRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../domain-packs/packs/ai-native-startup/fixtures"
);
const fixtureRoot = join(fixturesRoot, "dogfood-saas");

describe("startup dogfood fixture", () => {
  it("runs idea to MVP, launch, and scale readiness on a realistic SaaS fixture", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-dogfood-saas-"));

    try {
      await cp(fixtureRoot, workspace, { recursive: true });

      await runCli("startup", "init", "--cwd", workspace, "--stage", "mvp");
      await runCli(
        "startup",
        "context",
        "generate",
        "--cwd",
        workspace,
        "--architecture",
        "Readiness summaries are deterministic and evidence-backed.",
        "--constraint",
        "Launch readiness requires verifier and metric snapshot evidence."
      );
      await runCli(
        "startup",
        "measurement",
        "generate",
        "--cwd",
        workspace,
        "--activation",
        "Beta founder generates the first launch readiness summary",
        "--retention",
        "Beta founder returns for the weekly launch review"
      );

      const problemHypothesisId = await addHypotheses(workspace);

      await runCli(
        "startup",
        "evidence",
        "customer-interview",
        "--cwd",
        workspace,
        "--persona",
        "technical founder",
        "--problem",
        "AI-coded products lack credible launch readiness evidence",
        "--summary",
        "Founder needs a launch readiness summary before inviting beta users",
        "--signal-strength",
        "strong",
        "--hypothesis",
        problemHypothesisId,
        "--source",
        "support/issue-001.md"
      );
      await runCli(
        "startup",
        "evidence",
        "competitor",
        "--cwd",
        workspace,
        "--competitor",
        "manual launch checklist",
        "--finding",
        "Manual checklists do not bind claims to verifier evidence",
        "--signal-strength",
        "medium",
        "--hypothesis",
        problemHypothesisId,
        "--source",
        "gtm/claims.md"
      );
      await runCli(
        "startup",
        "evidence",
        "add",
        "--cwd",
        workspace,
        "--type",
        "disconfirming",
        "--summary",
        "One founder would ship after CI only",
        "--source",
        "support/issue-001.md"
      );
      await runCli(
        "startup",
        "measurement",
        "snapshot",
        "--cwd",
        workspace,
        "--metric",
        "activation",
        "--source",
        "analytics/metrics.json",
        "--threshold",
        "0.40",
        "--current",
        "0.57",
        "--source-ref",
        "analytics/metrics.json",
        "--false-positive",
        "Exclude founder smoke-test accounts from activation counts"
      );

      expect(
        await runCli("startup", "gate", "check", "--cwd", workspace, "--stage", "mvp")
      ).toContain("Status: passed");

      await runCli("startup", "launch", "audit", "--cwd", workspace);
      await runCli("startup", "launch", "security-baseline", "--cwd", workspace);
      await runVerifier(workspace);
      await addLaunchEvidence(workspace);

      expect(
        await runCli(
          "startup",
          "gate",
          "check",
          "--cwd",
          workspace,
          "--stage",
          "launch"
        )
      ).toContain("Status: passed");
      expect(
        await runCli("startup", "launch", "prepare", "--cwd", workspace)
      ).toContain("Status: launch_ready");

      await runScalePath(workspace);

      expect(
        await runCli("startup", "gate", "check", "--cwd", workspace, "--stage", "scale")
      ).toContain("Status: passed");
      await runCli("startup", "launch", "report", "--cwd", workspace);
      const report = await readFile(
        join(
          workspace,
          ".runstead",
          "reports",
          "launch-readiness-ai-native-startup.md"
        ),
        "utf8"
      );
      const opsReport = await readFile(
        join(workspace, ".runstead", "reports", "startup-ops-2026-W20.md"),
        "utf8"
      );

      expect(report).toContain("Status: launch_ready");
      expect(report).toContain("Structured Startup Artifacts");
      expect(opsReport).toContain("readiness-summary");
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  }, 20_000);

  it("classifies reference fixtures across tiny, broken, and mature launch states", async () => {
    await withFixture("tiny-todo", async (workspace) => {
      await runCli("startup", "init", "--cwd", workspace, "--stage", "mvp");
      await runCli("startup", "launch", "audit", "--cwd", workspace);

      const readiness = await readFile(
        join(workspace, ".runstead", "startup", "repo-readiness.md"),
        "utf8"
      );

      expect(readiness).toContain("## Release Blockers\n\n- none");
      expect(readiness).toContain("Package manager: npm (package_json)");
    });

    await withFixture("broken-launch-repo", async (workspace) => {
      await runCli("startup", "init", "--cwd", workspace, "--stage", "launch");
      await runCli("startup", "launch", "audit", "--cwd", workspace);

      const readiness = await readFile(
        join(workspace, ".runstead", "startup", "repo-readiness.md"),
        "utf8"
      );
      const gate = await runCli(
        "startup",
        "gate",
        "check",
        "--cwd",
        workspace,
        "--stage",
        "launch"
      );

      expect(readiness).toContain("test command is missing");
      expect(readiness).toContain("CI configuration is missing");
      expect(gate).toContain("Status: blocked");
    });

    await withFixture("existing-mature-repo", async (workspace) => {
      await runCli("startup", "init", "--cwd", workspace, "--stage", "launch");
      await runCli("startup", "launch", "audit", "--cwd", workspace);
      await runCli("startup", "launch", "security-baseline", "--cwd", workspace);

      const readiness = await readFile(
        join(workspace, ".runstead", "startup", "repo-readiness.md"),
        "utf8"
      );
      const security = await readFile(
        join(workspace, ".runstead", "startup", "security-baseline.md"),
        "utf8"
      );

      expect(readiness).toContain("## Release Blockers\n\n- none");
      expect(security).toContain("## Launch Security Blockers\n\n- none");
      expect(security).toContain("Dependency Findings\n- none");
    });
  }, 20_000);
});

async function withFixture(
  fixtureName: string,
  callback: (workspace: string) => Promise<void>
): Promise<void> {
  const workspace = await mkdtemp(join(tmpdir(), `runstead-${fixtureName}-`));

  try {
    await cp(join(fixturesRoot, fixtureName), workspace, { recursive: true });
    await callback(workspace);
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
}

async function addHypotheses(workspace: string): Promise<string> {
  let problemHypothesisId: string | undefined;

  for (const [kind, statement] of [
    ["problem", "AI-coded MVP launches lack trusted readiness evidence"],
    ["user", "Technical founders need launch gates with evidence"],
    ["solution", "Runstead produces verifier-backed launch readiness reports"]
  ] as const) {
    const output = await runCli(
      "startup",
      "hypothesis",
      "add",
      "--cwd",
      workspace,
      "--kind",
      kind,
      "--statement",
      statement,
      "--status",
      "validated"
    );

    if (kind === "problem") {
      problemHypothesisId = extractRecordedId(output);
    }
  }

  if (problemHypothesisId === undefined) {
    throw new Error("Expected problem hypothesis id");
  }

  return problemHypothesisId;
}

async function runVerifier(workspace: string): Promise<void> {
  const verifierTask = listTasks({ cwd: workspace }).tasks.find(
    (task) => task.type === "run_mvp_verifiers"
  );

  if (verifierTask === undefined) {
    throw new Error("Expected run_mvp_verifiers task");
  }

  await runCli(
    "verifier",
    "run",
    verifierTask.id,
    "--cwd",
    workspace,
    "--timeout-ms",
    "15000"
  );
}

async function addLaunchEvidence(workspace: string): Promise<void> {
  for (const item of [
    {
      type: "migration_plan",
      summary: "No schema migration is required",
      source: "docs/migration-plan.md"
    },
    {
      type: "rollback_plan",
      summary: "Rollback disables the readiness summary feature flag",
      source: "docs/rollback-plan.md"
    },
    {
      type: "observability",
      summary: "Dashboard tracks readiness summaries and activation",
      source: "docs/observability.md"
    }
  ]) {
    await runCli(
      "startup",
      "evidence",
      "add",
      "--cwd",
      workspace,
      "--type",
      item.type,
      "--summary",
      item.summary,
      "--source",
      item.source,
      "--content",
      launchEvidenceContent(item.type)
    );
  }

  await runCli(
    "startup",
    "launch",
    "bottleneck-map",
    "--cwd",
    workspace,
    "--bottleneck",
    "Founder-only release readiness judgment",
    "--owner",
    "ops-lead",
    "--status",
    "handoff-complete"
  );
}

async function runScalePath(workspace: string): Promise<void> {
  await runCli("startup", "init", "--cwd", workspace, "--stage", "scale");
  await runCli(
    "startup",
    "scale",
    "workflow-registry",
    "--cwd",
    workspace,
    "--workflow",
    "Weekly launch readiness review",
    "--delegation-rule",
    "Agents may draft readiness reports from recorded evidence",
    "--approval-boundary",
    "publish",
    "--allowed-agent",
    "codex_cli",
    "--constrained-task",
    "startup_remediation"
  );
  await runCli(
    "startup",
    "scale",
    "memory-capture",
    "--cwd",
    workspace,
    "--knowledge",
    "Beta customer readiness summaries are reviewed before GTM updates"
  );
  await runCli(
    "startup",
    "scale",
    "memory-retrieve",
    "--cwd",
    workspace,
    "--query",
    "readiness summaries"
  );
  await runCli(
    "startup",
    "scale",
    "integration-map",
    "--cwd",
    workspace,
    "--integration",
    "CRM readiness summary sync",
    "--lock-in-signal",
    "Customers review launch evidence in CRM",
    "--adoption-signal",
    "Two beta customers review CRM readiness summaries weekly",
    "--workflow-signal",
    "Weekly launch review starts from CRM readiness sync",
    "--automation-coverage",
    "CRM sync is generated from Runstead evidence"
  );
  await runCli(
    "startup",
    "launch",
    "support-triage",
    "--cwd",
    workspace,
    "--request",
    "Customer needs a readiness summary before beta invite",
    "--outcome",
    "Add readiness summary support category to scale report",
    "--category",
    "readiness-summary",
    "--source",
    "support/issue-001.md"
  );
  await runCli(
    "startup",
    "scale",
    "sop-generate",
    "--cwd",
    workspace,
    "--sop",
    "Generate launch readiness report before weekly beta review",
    "--owner",
    "ops-lead",
    "--workflow",
    "weekly launch readiness review"
  );
  await runCli(
    "startup",
    "scale",
    "gtm-verify",
    "--cwd",
    workspace,
    "--claim",
    "Runstead produces evidence-backed launch readiness reports for AI-coded MVPs",
    "--evidence",
    "gtm/claims.md",
    "--product-state",
    "dogfood fixture launch gate passed"
  );
  await runCli(
    "startup",
    "scale",
    "schedule-report",
    "--cwd",
    workspace,
    "--cadence",
    "weekly",
    "--owner",
    "ops-lead",
    "--period-template",
    "2026-W20"
  );
  await runCli(
    "startup",
    "scale",
    "report",
    "--cwd",
    workspace,
    "--period",
    "2026-W20"
  );
}

async function runCli(...args: string[]): Promise<string> {
  const output: string[] = [];
  const previousExitCode = process.exitCode;
  const log = vi.spyOn(console, "log").mockImplementation((...items: unknown[]) => {
    output.push(items.map(String).join(" "));
  });

  try {
    process.exitCode = undefined;
    await createProgram({ entrypoint: "/usr/local/bin/runstead" }).parseAsync(args, {
      from: "user"
    });
  } finally {
    process.exitCode = previousExitCode;
    log.mockRestore();
  }

  return output.join("\n");
}

function extractRecordedId(output: string): string {
  const match = /Recorded startup hypothesis: (\S+)/.exec(output);

  if (match?.[1] === undefined) {
    throw new Error(`Could not extract hypothesis id from output: ${output}`);
  }

  return match[1];
}

function launchEvidenceContent(type: string): string {
  return JSON.stringify({
    owner: "founder",
    remediationTask: `Maintain ${type} evidence for dogfood launch`,
    acceptanceCriteria: `${type} evidence is present before launch`
  });
}
