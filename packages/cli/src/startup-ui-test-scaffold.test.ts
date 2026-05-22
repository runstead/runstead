import { mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { initRunstead } from "./init.js";
import {
  formatStartupUiTestScaffold,
  generateStartupUiTestScaffold
} from "./startup-ui-test-scaffold.js";

describe("startup UI test scaffold", () => {
  it("writes a project DOM smoke test and Runstead guide", async () => {
    const workspace = join(tmpdir(), `runstead-startup-ui-scaffold-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      await mkdir(workspace, { recursive: true });
      await initRunstead({ cwd: workspace });

      const result = await generateStartupUiTestScaffold({
        cwd: workspace,
        url: "http://localhost:4173",
        flow: "create and complete todo",
        expectText: ["Todo MVP", "Add todo", "Todo MVP"],
        now: new Date("2026-05-14T05:00:00.000Z")
      });
      const testFile = await readFile(result.testPath, "utf8");
      const guide = await readFile(result.guidePath, "utf8");

      expect(result.expectText).toEqual(["Todo MVP", "Add todo"]);
      expect(testFile).toContain("node:test");
      expect(testFile).toContain("RUNSTEAD_UI_URL");
      expect(testFile).toContain("Expected UI text not found");
      expect(guide).toContain("# Runstead UI Test Scaffold");
      expect(guide).toContain("create and complete todo");
      expect(formatStartupUiTestScaffold(result)).toContain("Startup UI test scaffold");
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});
