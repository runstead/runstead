import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { initRunstead } from "./init.js";
import { executeStartupReadinessExtensions } from "./startup-extension-execution.js";
import { planStartupReady } from "./startup-ready.js";

const examplesRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../docs/examples/extensions"
);

describe("startup extension examples", () => {
  it("loads copyable integration examples into startup-ready planning", async () => {
    const workspace = join(tmpdir(), `runstead-extension-examples-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      await mkdir(workspace, { recursive: true });
      const initialized = await initRunstead({
        cwd: workspace,
        profile: "trusted-local"
      });

      await mkdir(join(initialized.root, "extensions"), { recursive: true });

      for (const name of [
        "posthog-activation.yaml",
        "vercel-deployment.yaml",
        "sentry-error-rate.yaml",
        "github-actions-ci.yaml"
      ]) {
        await cp(join(examplesRoot, name), join(initialized.root, "extensions", name));
      }

      const plan = await planStartupReady({
        cwd: workspace,
        stage: "launch",
        target: "production",
        worker: "codex_direct",
        governanceProfile: "governed",
        now: new Date("2026-05-24T01:30:00.000Z")
      });
      const extensions = plan.phases.find((phase) => phase.id === "extensions");
      const launchReport = plan.phases.find((phase) => phase.id === "launch_report");

      expect(plan.extensions.loaded.sort()).toEqual([
        "github-actions-ci-readiness",
        "posthog-activation-readiness",
        "sentry-error-rate-readiness",
        "vercel-deployment-readiness"
      ]);
      expect(extensions?.blockers).toEqual(
        expect.arrayContaining([
          "extension posthog-activation-readiness/activation-metric requires startup_metric_snapshot evidence",
          "extension github-actions-ci-readiness/ci-status requires startup_decision evidence"
        ])
      );
      expect(launchReport?.blockers).toEqual(
        expect.arrayContaining([
          "extension sentry-error-rate-readiness/error-rate requires startup_observability evidence",
          "extension vercel-deployment-readiness/deployment-status requires startup_release_plan evidence"
        ])
      );
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("executes a package-shaped extension collector", async () => {
    const workspace = join(
      tmpdir(),
      `runstead-extension-package-example-${process.pid}`
    );

    try {
      await rm(workspace, { force: true, recursive: true });
      await mkdir(workspace, { recursive: true });
      const initialized = await initRunstead({
        cwd: workspace,
        profile: "trusted-local"
      });

      await mkdir(join(initialized.root, "extensions"), { recursive: true });
      await cp(
        join(examplesRoot, "growth-readiness-package"),
        join(initialized.root, "extensions", "growth-readiness-package"),
        { recursive: true }
      );
      await writeFile(
        join(workspace, "package.json"),
        `${JSON.stringify(
          {
            private: true,
            scripts: {
              test: "node .runstead/extensions/growth-readiness-package/collector.mjs"
            }
          },
          null,
          2
        )}\n`,
        "utf8"
      );

      const result = await executeStartupReadinessExtensions({
        cwd: workspace,
        target: "local",
        stage: "launch",
        worker: "codex_cli",
        governanceProfile: "readiness",
        now: new Date("2026-05-24T01:40:00.000Z")
      });
      const evidenceId = result.evidenceIds[0];

      if (evidenceId === undefined) {
        throw new Error("Expected package-shaped extension evidence");
      }

      const artifact = JSON.parse(
        await readFile(
          join(
            workspace,
            ".runstead",
            "evidence",
            `startup-metric_snapshot-${evidenceId}.json`
          ),
          "utf8"
        )
      ) as { content: string };
      const content = JSON.parse(artifact.content) as {
        metric: string;
        sampleSize: number;
        runsteadExtension: {
          extensionId: string;
          collectorId: string;
        };
      };

      expect(result.status).toBe("passed");
      expect(result.loaded).toEqual(["growth-package-readiness"]);
      expect(result.collectorResults).toEqual([
        expect.objectContaining({
          extensionId: "growth-package-readiness",
          collectorId: "package-activation",
          status: "passed"
        })
      ]);
      expect(content).toMatchObject({
        metric: "activation",
        sampleSize: 120,
        runsteadExtension: {
          extensionId: "growth-package-readiness",
          collectorId: "package-activation"
        }
      });
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});
