import { cp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { initRunstead } from "./init.js";
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
});
