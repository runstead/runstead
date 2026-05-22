import { readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import { installDomainPack } from "./domain-pack-install.js";
import { createGoal } from "./goals.js";
import { createProgram } from "./index.js";
import { initRunstead } from "./init.js";
import { checkStartupGate } from "./startup-evidence.js";
import { recordStartupUiValidation } from "./startup-ui-validation.js";

describe("startup UI validation evidence", () => {
  it("records UI validation artifacts and blocks launch on failed checks", async () => {
    const workspace = join(tmpdir(), `runstead-startup-ui-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      await initRunstead({ cwd: workspace });
      await installDomainPack({
        cwd: workspace,
        ref: "ai-native-startup",
        now: new Date("2026-05-14T02:00:00.000Z")
      });
      const created = await createGoal({
        cwd: workspace,
        domain: "ai-native-startup",
        template: "build-mvp",
        now: new Date("2026-05-14T03:00:00.000Z")
      });

      const recorded = await recordStartupUiValidation({
        cwd: workspace,
        url: "http://localhost:3000",
        viewport: "390x844",
        screenshot: "file:.runstead/evidence/mobile-home.png",
        domStatus: "pass",
        accessibilityStatus: "fail",
        responsiveStatus: "pass",
        criticalFlow: "add todo",
        criticalFlowStatus: "pass",
        goalId: created.goal.id,
        now: new Date("2026-05-14T03:10:00.000Z")
      });
      const artifact = JSON.parse(
        await readFile(recorded.evidence.artifactPath, "utf8")
      ) as { evidenceType: string; sources: { kind: string; uri: string }[]; content: string };
      const content = JSON.parse(artifact.content) as Record<string, unknown>;
      const gate = await checkStartupGate({
        cwd: workspace,
        stage: "launch",
        now: new Date("2026-05-14T03:20:00.000Z")
      });
      const cliOutput = await runCli(
        "startup",
        "launch",
        "ui-validate",
        "--cwd",
        workspace,
        "--url",
        "http://localhost:3000",
        "--viewport",
        "desktop",
        "--screenshot",
        "file:.runstead/evidence/desktop-home.png",
        "--dom",
        "pass",
        "--accessibility",
        "pass",
        "--responsive",
        "pass",
        "--flow",
        "add todo",
        "--flow-status",
        "pass"
      );

      expect(recorded.failed).toBe(true);
      expect(artifact.evidenceType).toBe("ui_validation");
      expect(artifact.sources).toMatchObject([
        {
          kind: "browser_ui",
          uri: "file:.runstead/evidence/mobile-home.png"
        }
      ]);
      expect(content).toMatchObject({
        url: "http://localhost:3000",
        viewport: "390x844",
        accessibilityStatus: "fail",
        criticalFlow: "add todo"
      });
      expect(gate.blockers).toContain(
        "frontend UI validation failed: UI validation failed for http://localhost:3000 390x844"
      );
      expect(cliOutput).toContain("Recorded UI validation evidence:");
      expect(cliOutput).toContain("Failed: no");
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("copies local screenshot evidence into the Runstead asset store", async () => {
    const workspace = join(tmpdir(), `runstead-startup-ui-assets-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      await initRunstead({ cwd: workspace });
      const screenshotPath = join(workspace, "mobile-home.png");

      await writeFile(screenshotPath, "fake screenshot bytes", "utf8");

      const recorded = await recordStartupUiValidation({
        cwd: workspace,
        url: "http://localhost:3000",
        viewport: "390x844",
        screenshot: screenshotPath,
        domStatus: "pass",
        accessibilityStatus: "pass",
        responsiveStatus: "pass",
        criticalFlowStatus: "pass",
        now: new Date("2026-05-14T03:30:00.000Z")
      });
      const artifact = JSON.parse(
        await readFile(recorded.evidence.artifactPath, "utf8")
      ) as {
        sources: { uri: string; hash?: string }[];
        content: string;
      };
      const content = JSON.parse(artifact.content) as {
        screenshot: string;
        originalScreenshot: string;
      };
      const storedPath = fileURLToPath(content.screenshot);

      expect(content.originalScreenshot).toBe(screenshotPath);
      expect(storedPath).toContain(join(".runstead", "evidence", "assets"));
      expect(artifact.sources[0]).toMatchObject({
        uri: content.screenshot,
        hash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/)
      });
      await expect(readFile(storedPath, "utf8")).resolves.toBe(
        "fake screenshot bytes"
      );
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});

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
