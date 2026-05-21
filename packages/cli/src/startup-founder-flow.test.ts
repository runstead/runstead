import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  formatStartupBuildMvp,
  formatStartupLaunchCheck,
  formatStartupOnboard,
  formatStartupScaleCheck,
  startupBuildMvp,
  startupLaunchCheck,
  startupOnboard,
  startupScaleCheck
} from "./startup-founder-flow.js";

describe("startup founder flow", () => {
  it("runs the short founder command path with reusable lower-level artifacts", async () => {
    const workspace = join(tmpdir(), `runstead-startup-founder-flow-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      await mkdir(workspace, { recursive: true });
      await writeFile(
        join(workspace, "package.json"),
        `${JSON.stringify(
          {
            name: "founder-flow-fixture",
            private: true
          },
          null,
          2
        )}\n`,
        "utf8"
      );

      const onboard = await startupOnboard({
        cwd: workspace,
        now: new Date("2026-05-14T01:00:00.000Z")
      });
      const onboardAgain = await startupOnboard({
        cwd: workspace,
        now: new Date("2026-05-14T01:05:00.000Z")
      });
      const build = await startupBuildMvp({
        cwd: workspace,
        worker: "codex_cli",
        now: new Date("2026-05-14T01:10:00.000Z"),
        workerRunner: () =>
          Promise.resolve({
            stdout: JSON.stringify({
              summary: "built MVP fixture",
              files_changed: [],
              commands_run: [],
              risks: [],
              needs_approval: false,
              approval_reason: null
            }),
            stderr: "",
            exitCode: 0
          })
      });
      const launch = await startupLaunchCheck({
        cwd: workspace,
        now: new Date("2026-05-14T01:20:00.000Z")
      });
      const scale = await startupScaleCheck({
        cwd: workspace,
        now: new Date("2026-05-14T01:30:00.000Z")
      });

      expect(onboard.context.status).toBe("generated");
      expect(onboard.measurement.status).toBe("generated");
      expect(onboard.repo.stateBoundary.ignoredState).toBe(true);
      expect(onboard.repo.packageManager).toBe("npm");
      expect(onboard.nextCommands).toContain(
        "runstead startup build-mvp --worker codex_cli"
      );
      expect(onboardAgain.context.status).toBe("skipped");
      expect(onboardAgain.measurement.status).toBe("skipped");
      expect(build.status).toBe("completed");
      expect(build.gate.passed).toBe(false);
      expect(launch.status).toBe("blocked");
      expect(launch.reportPath).toContain("launch-readiness-ai-native-startup.md");
      expect(scale.gate.passed).toBe(false);
      expect(formatStartupOnboard(onboard)).toContain("Startup onboard");
      expect(formatStartupBuildMvp(build)).toContain("Startup build MVP");
      expect(formatStartupLaunchCheck(launch)).toContain("Startup launch check");
      expect(formatStartupScaleCheck(scale)).toContain("Startup scale check");
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});
