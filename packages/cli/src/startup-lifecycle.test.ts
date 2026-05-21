import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openRunsteadDatabase } from "@runstead/state-sqlite";
import { describe, expect, it, vi } from "vitest";

import { createProgram } from "./index.js";
import { listTasks, showTask } from "./tasks.js";

describe("startup CLI lifecycle", () => {
  it("runs the startup lifecycle from init through verifier-backed gates", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-startup-lifecycle-"));

    try {
      await writeStartupFixture(workspace);

      await runCli("startup", "init", "--cwd", workspace, "--stage", "launch");
      await runCli(
        "startup",
        "context",
        "generate",
        "--cwd",
        workspace,
        "--architecture",
        "Keep lifecycle evidence auditable.",
        "--constraint",
        "Verifier evidence must be current."
      );
      await runCli(
        "startup",
        "measurement",
        "generate",
        "--cwd",
        workspace,
        "--activation",
        "Founder completes a governed launch check",
        "--retention",
        "Founder repeats the launch check after a product change"
      );

      let problemHypothesisId: string | undefined;

      for (const [kind, statement] of [
        ["problem", "Founders cannot trust AI-coded launch readiness"],
        ["user", "Technical founders need evidence-backed launch gates"],
        ["solution", "Runstead records verifier-backed startup gates"]
      ] as const) {
        const hypothesisOutput = await runCli(
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
          problemHypothesisId = extractRecordedId(hypothesisOutput);
        }
      }

      if (problemHypothesisId === undefined) {
        throw new Error("Expected problem hypothesis id");
      }

      await runCli(
        "startup",
        "evidence",
        "customer-interview",
        "--cwd",
        workspace,
        "--persona",
        "technical founder",
        "--problem",
        "AI-coded launches lack evidence-backed readiness",
        "--summary",
        "Three founders asked for governed launch evidence",
        "--source",
        "interview-notes:2026-05-14",
        "--hypothesis",
        problemHypothesisId,
        "--signal-strength",
        "strong"
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
        "manual snapshot",
        "--threshold",
        "0.40",
        "--current",
        "0.51",
        "--source-ref",
        "analytics:activation:2026-05-14"
      );
      await runCli(
        "startup",
        "evidence",
        "competitor",
        "--cwd",
        workspace,
        "--competitor",
        "CI-only launch checklist",
        "--finding",
        "CI proves commands pass but not founder launch readiness",
        "--signal-strength",
        "medium",
        "--hypothesis",
        problemHypothesisId,
        "--source",
        "competitor-notes:2026-05-14"
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
        "One founder would ship with CI only"
      );

      const mvpGate = await runCli(
        "startup",
        "gate",
        "check",
        "--cwd",
        workspace,
        "--stage",
        "mvp"
      );

      expect(mvpGate).toContain("Status: passed");

      await runCli("startup", "launch", "audit", "--cwd", workspace);
      await runCli("startup", "launch", "security-baseline", "--cwd", workspace);

      const verifierTask = listTasks({ cwd: workspace }).tasks.find(
        (task) => task.type === "run_mvp_verifiers"
      );

      if (verifierTask === undefined) {
        throw new Error("Expected startup init to create run_mvp_verifiers task");
      }

      expect(verifierTask.input).toMatchObject({
        commands: [
          { name: "test", command: "npm test" },
          { name: "lint", command: "npm run lint" },
          { name: "typecheck", command: "npm run typecheck" },
          { name: "build", command: "npm run build" }
        ]
      });

      const verifierRun = await runCli(
        "verifier",
        "run",
        verifierTask.id,
        "--cwd",
        workspace,
        "--timeout-ms",
        "15000"
      );

      expect(verifierRun).toContain("Status: completed");
      expect(verifierRun).toContain("build: exit=0");
      expect(showTask({ cwd: workspace, id: verifierTask.id }).task.status).toBe(
        "completed"
      );

      for (const [type, summary] of [
        ["migration_plan", "No migration is required for the lifecycle fixture"],
        ["rollback_plan", "Rollback restores the previous release artifact"],
        ["observability", "Launch alerts route to the founder dashboard"]
      ] as const) {
        await runCli(
          "startup",
          "evidence",
          "add",
          "--cwd",
          workspace,
          "--type",
          type,
          "--summary",
          summary,
          "--content",
          launchRemediationContent(type)
        );
      }
      await runCli(
        "startup",
        "launch",
        "bottleneck-map",
        "--cwd",
        workspace,
        "--bottleneck",
        "Founder-only rollback decision",
        "--owner",
        "ops-lead"
      );

      const launchGate = await runCli(
        "startup",
        "gate",
        "check",
        "--cwd",
        workspace,
        "--stage",
        "launch"
      );

      expect(launchGate).toContain("Status: passed");

      await runCli("startup", "init", "--cwd", workspace, "--stage", "scale");
      await runCli(
        "startup",
        "scale",
        "workflow-registry",
        "--cwd",
        workspace,
        "--workflow",
        "Weekly startup readiness review",
        "--delegation-rule",
        "Agents may draft readiness reports from recorded evidence",
        "--approval-boundary",
        "publish"
      );
      await runCli(
        "startup",
        "scale",
        "memory-capture",
        "--cwd",
        workspace,
        "--knowledge",
        "Enterprise onboarding depends on the founder's manual review"
      );
      await runCli(
        "startup",
        "scale",
        "integration-map",
        "--cwd",
        workspace,
        "--integration",
        "CRM launch readiness sync",
        "--lock-in-signal",
        "Customer reviews launch evidence inside CRM",
        "--automation-coverage",
        "CRM sync is agent-assisted"
      );
      await runCli(
        "startup",
        "launch",
        "support-triage",
        "--cwd",
        workspace,
        "--request",
        "Beta customer needs readiness summary",
        "--outcome",
        "Add to weekly scale report"
      );
      await runCli(
        "startup",
        "scale",
        "sop-generate",
        "--cwd",
        workspace,
        "--sop",
        "Generate the startup scale report every Monday",
        "--owner",
        "ops-lead",
        "--workflow",
        "weekly ops review"
      );
      await runCli(
        "startup",
        "scale",
        "gtm-verify",
        "--cwd",
        workspace,
        "--claim",
        "Runstead produces evidence-backed launch readiness reports",
        "--evidence",
        "startup:launch-gate",
        "--product-state",
        "CLI lifecycle fixture passed"
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

      const scaleGate = await runCli(
        "startup",
        "gate",
        "check",
        "--cwd",
        workspace,
        "--stage",
        "scale"
      );

      expect(scaleGate).toContain("Status: passed");
      await expect(readFile(join(workspace, "AGENTS.md"), "utf8")).resolves.toContain(
        "Startup Agent Context"
      );
      await expect(
        readFile(
          join(workspace, ".runstead", "reports", "startup-ops-2026-W20.md"),
          "utf8"
        )
      ).resolves.toContain("Startup Scale Ops Report");
      expect(readEvidenceTypes(workspace)).toEqual(
        expect.arrayContaining([
          "command_output",
          "startup_agent_context",
          "startup_founder_bottleneck",
          "startup_gtm_artifact",
          "startup_measurement_framework",
          "startup_ops_report",
          "startup_repo_readiness",
          "startup_security_baseline",
          "startup_workflow_registry"
        ])
      );
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});

async function writeStartupFixture(workspace: string): Promise<void> {
  await writeFile(
    join(workspace, "package.json"),
    `${JSON.stringify(
      {
        name: "startup-lifecycle-fixture",
        private: true,
        packageManager: "npm@10.0.0",
        scripts: {
          test: "node -e \"console.log('test ok')\"",
          lint: "node -e \"console.log('lint ok')\"",
          typecheck: "node -e \"console.log('typecheck ok')\"",
          build: "node -e \"console.log('build ok')\""
        }
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await mkdir(join(workspace, ".github", "workflows"), { recursive: true });
  await writeFile(
    join(workspace, ".github", "workflows", "ci.yml"),
    "name: ci\non: [push]\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps: []\n",
    "utf8"
  );
}

async function runCli(...args: string[]): Promise<string> {
  const output: string[] = [];
  const log = vi.spyOn(console, "log").mockImplementation((...items: unknown[]) => {
    output.push(items.map(String).join(" "));
  });

  try {
    await createProgram({ entrypoint: "/usr/local/bin/runstead" }).parseAsync(args, {
      from: "user"
    });
  } finally {
    log.mockRestore();
  }

  return output.join("\n");
}

function readEvidenceTypes(workspace: string): string[] {
  const database = openRunsteadDatabase(join(workspace, ".runstead", "state.db"));

  try {
    return (
      database
        .prepare(
          `
          SELECT DISTINCT type
          FROM evidence
          ORDER BY type ASC
        `
        )
        .all() as { type: string }[]
    ).map((row) => row.type);
  } finally {
    database.close();
  }
}

function extractRecordedId(output: string): string {
  const match = /Recorded startup hypothesis: (\S+)/.exec(output);

  if (match?.[1] === undefined) {
    throw new Error(`Could not extract hypothesis id from output: ${output}`);
  }

  return match[1];
}

function launchRemediationContent(type: string): string {
  return JSON.stringify({
    owner: "founder",
    remediationTask: `Maintain ${type} evidence for launch readiness`,
    acceptanceCriteria: `${type} evidence is reviewed before launch`
  });
}
