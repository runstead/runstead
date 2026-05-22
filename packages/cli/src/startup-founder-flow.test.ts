import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  formatStartupBuildMvp,
  formatStartupLaunchCheck,
  formatStartupOnboard,
  formatStartupScaleCheck,
  formatStartupWorkerGovernanceNotice,
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
            private: true,
            scripts: {
              test: 'node -e "process.exit(0)"',
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
      expect(onboard.onboardingFiles.map((file) => file.split("/").at(-1))).toEqual([
        "quickstart.md",
        "upgrade-guide.md"
      ]);
      await expect(
        readFile(onboard.onboardingFiles[0] ?? "", "utf8")
      ).resolves.toContain("Runstead Startup Quickstart");
      await expect(
        readFile(onboard.onboardingFiles[1] ?? "", "utf8")
      ).resolves.toContain("runstead upgrade --cwd .");
      expect(onboardAgain.context.status).toBe("skipped");
      expect(onboardAgain.measurement.status).toBe("skipped");
      expect(build.status).toBe("completed");
      expect(build.verifierRun.status).toBe("completed");
      expect(build.gate.passed).toBe(false);
      expect(launch.status).toBe("blocked");
      expect(launch.reportPath).toContain("launch-readiness-ai-native-startup.md");
      expect(scale.gate.passed).toBe(false);
      expect(formatStartupOnboard(onboard)).toContain("Startup onboard");
      expect(formatStartupOnboard(onboard)).toContain("Onboarding files:");
      expect(formatStartupBuildMvp(build)).toContain("Startup build MVP");
      expect(formatStartupBuildMvp(build)).toContain("Verifier run: completed");
      expect(formatStartupWorkerGovernanceNotice("codex_cli")).toContain(
        "Level 1 process wrapper"
      );
      expect(formatStartupWorkerGovernanceNotice("codex_direct")).toContain(
        "Level 2 native tool proxy"
      );
      expect(formatStartupLaunchCheck(launch)).toContain("Startup launch check");
      expect(formatStartupScaleCheck(scale)).toContain("Startup scale check");
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  }, 60_000);

  it("passes suggested verifier commands to workers for empty repositories", async () => {
    const workspace = join(tmpdir(), `runstead-startup-founder-empty-${process.pid}`);
    let workerPrompt = "";

    try {
      await rm(workspace, { force: true, recursive: true });
      await mkdir(workspace, { recursive: true });

      const build = await startupBuildMvp({
        cwd: workspace,
        worker: "codex_cli",
        dependencyPolicy: "allow-listed",
        allowedDependencies: ["runtime:react", "dev:vitest"],
        now: new Date("2026-05-14T04:00:00.000Z"),
        workerRunner: async (_command, args, options) => {
          workerPrompt = args.join("\n");
          await writeFile(
            join(options.cwd, "package.json"),
            `${JSON.stringify(
              {
                name: "empty-mvp-fixture",
                private: true,
                scripts: {
                  test: 'node -e "process.exit(0)"',
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

          return {
            stdout: JSON.stringify({
              summary: "built empty MVP fixture",
              files_changed: ["package.json"],
              commands_run: [],
              risks: [],
              needs_approval: false,
              approval_reason: null
            }),
            stderr: "",
            exitCode: 0
          };
        }
      });

      expect(workerPrompt).toContain("test: npm test");
      expect(workerPrompt).toContain("lint: npm run lint");
      expect(workerPrompt).toContain("typecheck: npm run typecheck");
      expect(workerPrompt).toContain("build: npm run build");
      expect(workerPrompt).toContain("Dependency approval policy: allow-listed.");
      expect(workerPrompt).toContain(
        "Allowed dependency additions: runtime:react, dev:vitest."
      );
      expect(workerPrompt).toContain("dependencies outside allowed list");
      expect(build.dependencyApproval).toMatchObject({
        policy: "allow-listed",
        allowedDependencies: ["runtime:react", "dev:vitest"]
      });
      expect(formatStartupBuildMvp(build)).toContain("Dependency policy: allow-listed");
      expect(build.status).toBe("completed");
      expect(build.verifierRun.status).toBe("completed");
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  }, 30_000);
});
