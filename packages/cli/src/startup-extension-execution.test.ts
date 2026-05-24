import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { initRunstead } from "./init.js";
import { executeStartupReadinessExtensions } from "./startup-extension-execution.js";
import { startupReadinessExtensionVerifierCommands } from "./startup-extension-loader.js";
import { planStartupReady } from "./startup-ready.js";

describe("startup extension execution", () => {
  it("runs a local collector command and records startup evidence", async () => {
    const workspace = join(tmpdir(), `runstead-extension-collector-${process.pid}`);

    try {
      await prepareExtensionWorkspace(workspace, {
        collector: {
          safeForWrappedWorkers: true,
          qualityTier: "self_reported"
        }
      });

      const result = await executeStartupReadinessExtensions({
        cwd: workspace,
        target: "local",
        stage: "launch",
        worker: "codex_cli",
        governanceProfile: "readiness",
        now: new Date("2026-05-24T01:00:00.000Z")
      });
      const plan = await planStartupReady({
        cwd: workspace,
        target: "local",
        stage: "launch",
        now: new Date("2026-05-24T01:00:30.000Z")
      });
      const artifact = JSON.parse(
        await readFile(
          join(
            workspace,
            ".runstead",
            "evidence",
            `startup-metric_snapshot-${result.evidenceIds[0]}.json`
          ),
          "utf8"
        )
      ) as { content: string };
      const content = JSON.parse(artifact.content) as {
        metric: string;
        runsteadExtension: { collectorId: string };
      };

      expect(result.status).toBe("passed");
      expect(result.evidenceIds).toHaveLength(1);
      expect(content).toMatchObject({
        metric: "activation",
        runsteadExtension: {
          collectorId: "activation-local"
        }
      });
      expect(
        plan.phases.find((phase) => phase.id === "launch_report")?.blockers
      ).not.toContain(
        "extension growth-readiness/activation-metric requires startup_metric_snapshot evidence"
      );
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("blocks unsafe wrapped-worker collectors before execution", async () => {
    const workspace = join(
      tmpdir(),
      `runstead-extension-collector-policy-${process.pid}`
    );

    try {
      await prepareExtensionWorkspace(workspace, {
        collector: {
          safeForWrappedWorkers: false,
          qualityTier: "self_reported"
        }
      });

      const result = await executeStartupReadinessExtensions({
        cwd: workspace,
        target: "local",
        stage: "launch",
        worker: "codex_cli",
        governanceProfile: "readiness",
        now: new Date("2026-05-24T01:05:00.000Z")
      });

      expect(result.status).toBe("blocked");
      expect(result.blockers).toEqual([
        "extension growth-readiness/activation-local is not safe for Level 1 wrapped workers; use --worker codex_direct --governance governed"
      ]);
      expect(result.evidenceIds).toEqual([]);
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("blocks production collectors without target freshness metadata", async () => {
    const workspace = join(
      tmpdir(),
      `runstead-extension-collector-freshness-${process.pid}`
    );

    try {
      await prepareExtensionWorkspace(workspace, {
        collector: {
          safeForWrappedWorkers: true,
          qualityTier: "external_observed"
        }
      });

      const result = await executeStartupReadinessExtensions({
        cwd: workspace,
        target: "production",
        stage: "launch",
        worker: "codex_direct",
        governanceProfile: "governed",
        now: new Date("2026-05-24T01:10:00.000Z")
      });

      expect(result.status).toBe("blocked");
      expect(result.blockers).toEqual([
        "extension growth-readiness/activation-local must declare defaultFreshnessDays for production readiness"
      ]);
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("exposes extension verifiers as existing verifier commands", async () => {
    const workspace = join(tmpdir(), `runstead-extension-verifier-${process.pid}`);

    try {
      await prepareExtensionWorkspace(workspace, {
        collector: {
          safeForWrappedWorkers: true,
          qualityTier: "self_reported"
        }
      });

      await expect(
        startupReadinessExtensionVerifierCommands({ cwd: workspace })
      ).resolves.toEqual([
        {
          name: "extension:growth-readiness/metric-contract",
          command: "npm test -- --verify metrics"
        }
      ]);
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});

async function prepareExtensionWorkspace(
  workspace: string,
  options: {
    collector: {
      safeForWrappedWorkers: boolean;
      qualityTier: string;
      defaultFreshnessDays?: number;
    };
  }
): Promise<void> {
  await rm(workspace, { force: true, recursive: true });
  await mkdir(join(workspace, "scripts"), { recursive: true });
  const initialized = await initRunstead({
    cwd: workspace,
    profile: "trusted-local"
  });

  await writeFile(
    join(workspace, "package.json"),
    `${JSON.stringify(
      {
        private: true,
        scripts: {
          test: "node scripts/collector.mjs",
          lint: 'node -e "process.exit(0)"',
          typecheck: 'node -e "process.exit(0)"',
          build: 'node -e "process.exit(0)"'
        }
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await writeFile(
    join(workspace, "scripts", "collector.mjs"),
    [
      "const payload = {",
      "  evidence: [{",
      "    type: 'metric_snapshot',",
      "    summary: 'Activation metric from local collector',",
      "    content: {",
      "      metric: 'activation',",
      "      source: 'local-fixture',",
      "      threshold: 40,",
      "      current: 48",
      "    }",
      "  }]",
      "};",
      "console.log(JSON.stringify(payload));",
      ""
    ].join("\n"),
    "utf8"
  );
  await mkdir(join(initialized.root, "extensions"), { recursive: true });
  await writeFile(
    join(initialized.root, "extensions", "growth-readiness.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        id: "growth-readiness",
        version: "0.1.0",
        name: "Growth readiness",
        description: "Executable growth readiness collectors.",
        domains: ["ai-native-startup"],
        facets: [
          {
            name: "activation-metric",
            title: "Activation metric",
            description: "Activation metric evidence is required before launch.",
            appliesToTargets: ["local", "production"],
            requiredEvidenceTypes: ["startup_metric_snapshot"]
          }
        ],
        collectors: [
          {
            id: "activation-local",
            title: "Activation local collector",
            description: "Collect activation from a local fixture command.",
            command: "npm test -- --collector activation",
            targets: ["local", "production"],
            producesEvidenceTypes: ["startup_metric_snapshot"],
            safeForWrappedWorkers: options.collector.safeForWrappedWorkers,
            qualityTier: options.collector.qualityTier,
            ...(options.collector.defaultFreshnessDays === undefined
              ? {}
              : { defaultFreshnessDays: options.collector.defaultFreshnessDays })
          }
        ],
        verifiers: [
          {
            id: "metric-contract",
            command: "npm test -- --verify metrics",
            evidenceTier: "local_command",
            producesEvidenceTypes: ["command_output"]
          }
        ],
        gates: [
          {
            id: "local-growth",
            stage: "launch",
            target: "local",
            requiredFacets: ["activation-metric"]
          },
          {
            id: "production-growth",
            stage: "launch",
            target: "production",
            requiredFacets: ["activation-metric"],
            requiredEvidenceTiers: ["real_user_analytics"]
          }
        ]
      },
      null,
      2
    )}\n`,
    "utf8"
  );
}
