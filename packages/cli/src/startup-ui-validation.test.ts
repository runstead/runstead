import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import { installDomainPack } from "./domain-pack-install.js";
import { createGoal } from "./goals.js";
import { createProgram } from "./index.js";
import { initRunstead } from "./init.js";
import { checkStartupGate } from "./startup-evidence.js";
import {
  classifyStartupUiValidationFailure,
  executeStartupUiValidation,
  recordStartupUiValidation,
  summarizeStartupUiValidationFailure,
  startupUiValidationInfraStatus,
  startupUiValidationRepairHint
} from "./startup-ui-validation.js";

describe("startup UI validation evidence", () => {
  it("summarizes failures by the failed user action first", () => {
    expect(
      summarizeStartupUiValidationFailure({
        runner: "browser_flow_smoke",
        responseStatus: 200,
        responseOk: true,
        expectedText: [{ text: "Todo MVP", found: true }],
        flowActions: [
          {
            type: "fill",
            status: "pass",
            summary: "filled todo",
            selector: "input[type='text']"
          },
          {
            type: "click",
            status: "fail",
            summary: "button did not become enabled",
            selector: "button[type='submit']"
          }
        ]
      })
    ).toBe(
      "user action click selector \"button[type='submit']\" failed: button did not become enabled"
    );
  });

  it("classifies selector failures and suggests stable product test ids", () => {
    const execution = {
      runner: "browser_flow_smoke" as const,
      responseStatus: 200,
      responseOk: true,
      expectedText: [{ text: "Todo MVP", found: true }],
      flowActions: [
        {
          type: "fill" as const,
          status: "fail" as const,
          summary: "No matching selector found",
          expected: "Runstead smoke todo"
        }
      ]
    };

    expect(classifyStartupUiValidationFailure(execution)).toBe("selector_unstable");
    expect(startupUiValidationRepairHint(execution)).toContain(
      'data-testid="todo-input"'
    );
    expect(startupUiValidationRepairHint(execution)).toContain(
      'data-testid="todo-search"'
    );
  });

  it("classifies missing expected text as a product gap", () => {
    const execution = {
      runner: "browser_flow_smoke" as const,
      responseStatus: 200,
      responseOk: true,
      expectedText: [{ text: "Search", found: false }],
      flowActions: []
    };

    expect(classifyStartupUiValidationFailure(execution)).toBe("product_gap");
    expect(startupUiValidationRepairHint(execution)).toContain(
      "missing user-visible product state"
    );
    expect(startupUiValidationInfraStatus(execution)).toBe("pass");
  });

  it("classifies DevTools failures as browser infrastructure", () => {
    const execution = {
      runner: "browser_flow_smoke" as const,
      responseStatus: 0,
      responseOk: false,
      expectedText: [],
      flowActions: [],
      error: "Chrome exited before exposing DevTools websocket URL",
      failureCategory: "browser_runtime" as const
    };

    expect(classifyStartupUiValidationFailure(execution)).toBe("browser_runtime");
    expect(startupUiValidationInfraStatus(execution)).toBe("fail");
    expect(startupUiValidationRepairHint(execution)).toContain(
      "Playwright/Chrome availability"
    );
  });

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
      ) as {
        evidenceType: string;
        sources: { kind: string; uri: string }[];
        content: string;
      };
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

      await recordStartupUiValidation({
        cwd: workspace,
        url: "http://localhost:3000",
        viewport: "390x844",
        screenshot: "file:.runstead/evidence/mobile-home-fixed.png",
        domStatus: "pass",
        accessibilityStatus: "pass",
        responsiveStatus: "pass",
        criticalFlow: "add todo",
        criticalFlowStatus: "pass",
        goalId: created.goal.id,
        now: new Date("2026-05-14T03:30:00.000Z")
      });
      const clearedGate = await checkStartupGate({
        cwd: workspace,
        stage: "launch",
        now: new Date("2026-05-14T03:40:00.000Z")
      });

      expect(clearedGate.blockers).not.toContain(
        "frontend UI validation failed: UI validation failed for http://localhost:3000 390x844"
      );
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
        uri: content.screenshot
      });
      expect(artifact.sources[0]?.hash).toMatch(/^sha256:[a-f0-9]{64}$/);
      await expect(readFile(storedPath, "utf8")).resolves.toBe("fake screenshot bytes");
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("executes DOM smoke validation through a managed dev server", async () => {
    const workspace = join(tmpdir(), `runstead-startup-ui-execute-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      await mkdir(workspace, { recursive: true });
      await initRunstead({ cwd: workspace });
      await writeFile(
        join(workspace, "server.mjs"),
        [
          "import http from 'node:http';",
          "const html = '<!doctype html><html><head><title>Todo MVP</title></head><body><main><h1>Todo MVP</h1><button>Add todo</button></main></body></html>';",
          "const server = http.createServer((_request, response) => {",
          "  response.writeHead(200, { 'content-type': 'text/html' });",
          "  response.end(html);",
          "});",
          "server.listen(Number(process.env.PORT), '127.0.0.1');",
          "process.on('SIGTERM', () => server.close(() => process.exit(0)));"
        ].join("\n"),
        "utf8"
      );

      const executed = await executeStartupUiValidation({
        cwd: workspace,
        viewport: "desktop",
        serverCommand: "node server.mjs",
        timeoutMs: 5_000,
        criticalFlow: "load todo app",
        expectText: ["Todo MVP", "Add todo"],
        now: new Date("2026-05-14T04:00:00.000Z")
      });
      const artifact = JSON.parse(
        await readFile(executed.evidence.artifactPath, "utf8")
      ) as {
        content: string;
        sources: { kind: string; uri: string; hash?: string }[];
      };
      const content = JSON.parse(artifact.content) as {
        domStatus: string;
        accessibilityStatus: string;
        responsiveStatus: string;
        criticalFlowStatus: string;
        domArtifact: string;
        execution: {
          runner: string;
          responseStatus: number;
          expectedText: { text: string; found: boolean }[];
          server: { command: string; managed: boolean };
        };
      };

      expect(executed.failed).toBe(false);
      expect(executed.execution.server).toMatchObject({
        managed: true,
        command: "node server.mjs"
      });
      expect(content).toMatchObject({
        domStatus: "pass",
        accessibilityStatus: "pass",
        responsiveStatus: "pass",
        criticalFlowStatus: "pass",
        domArtifact: executed.domArtifact,
        execution: {
          runner: "http_dom_smoke",
          responseStatus: 200
        }
      });
      expect(content.execution.expectedText).toEqual([
        { text: "Todo MVP", found: true },
        { text: "Add todo", found: true }
      ]);
      expect(artifact.sources[0]).toMatchObject({
        kind: "browser_ui",
        uri: executed.domArtifact
      });
      expect(artifact.sources[0]?.hash).toMatch(/^sha256:[a-f0-9]{64}$/);
      await expect(
        readFile(fileURLToPath(executed.domArtifact), "utf8")
      ).resolves.toContain("Todo MVP");
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("executes interactive UI flow actions and stores failure artifacts", async () => {
    const workspace = join(tmpdir(), `runstead-startup-ui-flow-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      await initRunstead({ cwd: workspace });

      const executed = await executeStartupUiValidation({
        cwd: workspace,
        url: "http://127.0.0.1:3000",
        viewport: "desktop",
        criticalFlow: "todo golden path",
        expectText: ["Todo MVP", "Runstead smoke todo"],
        flowActions: [
          {
            type: "fill",
            selector: "input[type='text']",
            value: "Runstead smoke todo"
          },
          {
            type: "click",
            selector: "button[type='submit']"
          },
          {
            type: "expectText",
            text: "Runstead smoke todo"
          },
          {
            type: "expectPersisted",
            text: "Runstead smoke todo"
          }
        ],
        browserRunner: () =>
          Promise.resolve({
            responseStatus: 200,
            responseOk: true,
            html: "<main><h1>Todo MVP</h1><button>Add todo</button><p>Runstead smoke todo</p></main>",
            screenshot: Buffer.from("png bytes"),
            consoleMessages: ["[error] simulated console warning"],
            actionResults: [
              {
                type: "fill",
                status: "pass",
                summary: "filled input",
                selector: "input[type='text']"
              },
              {
                type: "click",
                status: "pass",
                summary: "clicked add",
                selector: "button[type='submit']"
              },
              {
                type: "expectText",
                status: "pass",
                summary: "found todo",
                expected: "Runstead smoke todo"
              },
              {
                type: "expectPersisted",
                status: "pass",
                summary: "persisted todo",
                expected: "Runstead smoke todo"
              }
            ]
          }),
        now: new Date("2026-05-14T04:30:00.000Z")
      });
      const artifact = JSON.parse(
        await readFile(executed.evidence.artifactPath, "utf8")
      ) as {
        content: string;
        sources: { kind: string; uri: string; hash?: string }[];
      };
      const content = JSON.parse(artifact.content) as {
        domStatus: string;
        criticalFlowStatus: string;
        screenshot: string;
        consoleErrors: string[];
        execution: {
          runner: string;
          flowActions: { type: string; status: string }[];
          artifacts: {
            dom: string;
            screenshot: string;
            consoleLog: string;
          };
        };
      };

      expect(executed.failed).toBe(false);
      expect(content).toMatchObject({
        domStatus: "pass",
        criticalFlowStatus: "pass",
        consoleErrors: ["[error] simulated console warning"],
        execution: {
          runner: "browser_flow_smoke",
          flowActions: [
            { type: "fill", status: "pass" },
            { type: "click", status: "pass" },
            { type: "expectText", status: "pass" },
            { type: "expectPersisted", status: "pass" }
          ]
        }
      });
      expect(content.screenshot).toBe(content.execution.artifacts.screenshot);
      expect(artifact.sources.map((source) => source.uri)).toEqual(
        expect.arrayContaining([
          content.execution.artifacts.dom,
          content.execution.artifacts.screenshot,
          content.execution.artifacts.consoleLog
        ])
      );
      await expect(
        readFile(fileURLToPath(content.execution.artifacts.screenshot), "utf8")
      ).resolves.toBe("png bytes");
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("retries browser infrastructure failures once before recording success", async () => {
    const workspace = join(
      tmpdir(),
      `runstead-startup-ui-retry-success-${process.pid}`
    );
    let attempts = 0;

    try {
      await rm(workspace, { force: true, recursive: true });
      await initRunstead({ cwd: workspace });

      const executed = await executeStartupUiValidation({
        cwd: workspace,
        url: "http://127.0.0.1:3000",
        viewport: "desktop",
        criticalFlow: "todo golden path",
        expectText: ["Todo MVP"],
        flowActions: [
          {
            type: "expectText",
            text: "Todo MVP"
          }
        ],
        browserRunner: () => {
          attempts += 1;

          if (attempts === 1) {
            throw new Error("Chrome DevTools websocket closed");
          }

          return Promise.resolve({
            responseStatus: 200,
            responseOk: true,
            html: "<main><h1>Todo MVP</h1><button>Add todo</button></main>",
            consoleMessages: [],
            actionResults: [
              {
                type: "expectText",
                status: "pass",
                summary: "found Todo MVP",
                expected: "Todo MVP"
              }
            ]
          });
        },
        now: new Date("2026-05-14T04:40:00.000Z")
      });
      const artifact = JSON.parse(
        await readFile(executed.evidence.artifactPath, "utf8")
      ) as { content: string };
      const content = JSON.parse(artifact.content) as {
        infraStatus: string;
        execution: {
          retryCount?: number;
          retryReason?: string;
        };
      };

      expect(attempts).toBe(2);
      expect(executed.failed).toBe(false);
      expect(content.infraStatus).toBe("pass");
      expect(content.execution.retryCount).toBe(1);
      expect(content.execution.retryReason).toContain("DevTools websocket closed");
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("records browser infrastructure failure tier after retry is exhausted", async () => {
    const workspace = join(
      tmpdir(),
      `runstead-startup-ui-retry-fail-${process.pid}`
    );
    let attempts = 0;

    try {
      await rm(workspace, { force: true, recursive: true });
      await initRunstead({ cwd: workspace });

      const executed = await executeStartupUiValidation({
        cwd: workspace,
        url: "http://127.0.0.1:3000",
        viewport: "desktop",
        criticalFlow: "todo golden path",
        expectText: ["Todo MVP"],
        flowActions: [
          {
            type: "expectText",
            text: "Todo MVP"
          }
        ],
        browserRunner: () => {
          attempts += 1;
          return Promise.reject(
            new Error("Chrome exited before exposing DevTools websocket URL")
          );
        },
        now: new Date("2026-05-14T04:45:00.000Z")
      });
      const artifact = JSON.parse(
        await readFile(executed.evidence.artifactPath, "utf8")
      ) as { content: string };
      const content = JSON.parse(artifact.content) as {
        infraStatus: string;
        execution: {
          failureCategory?: string;
          retryCount?: number;
          retryReason?: string;
          error?: string;
        };
      };

      expect(attempts).toBe(2);
      expect(executed.failed).toBe(true);
      expect(content.infraStatus).toBe("fail");
      expect(content.execution.failureCategory).toBe("browser_runtime");
      expect(content.execution.retryCount).toBe(1);
      expect(content.execution.retryReason).toContain(
        "Chrome exited before exposing DevTools websocket URL"
      );
      expect(content.execution.error).toContain("after retry");
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("keeps cleanup warnings from changing the UI smoke verdict", async () => {
    const workspace = join(
      tmpdir(),
      `runstead-startup-ui-cleanup-warning-${process.pid}`
    );

    try {
      await rm(workspace, { force: true, recursive: true });
      await initRunstead({ cwd: workspace });

      const executed = await executeStartupUiValidation({
        cwd: workspace,
        url: "http://127.0.0.1:3000",
        viewport: "desktop",
        criticalFlow: "todo golden path",
        expectText: ["Todo MVP"],
        flowActions: [
          {
            type: "expectText",
            text: "Todo MVP"
          }
        ],
        browserRunner: () =>
          Promise.resolve({
            responseStatus: 200,
            responseOk: true,
            html: "<main><h1>Todo MVP</h1><button>Add todo</button></main>",
            consoleMessages: [
              "[warn] failed to clean Chrome profile /tmp/runstead-ui-chrome-x: ENOTEMPTY"
            ],
            actionResults: [
              {
                type: "expectText",
                status: "pass",
                summary: "found Todo MVP",
                expected: "Todo MVP"
              }
            ]
          }),
        now: new Date("2026-05-14T04:50:00.000Z")
      });
      const artifact = JSON.parse(
        await readFile(executed.evidence.artifactPath, "utf8")
      ) as { content: string };
      const content = JSON.parse(artifact.content) as {
        infraStatus: string;
        consoleErrors: string[];
      };

      expect(executed.failed).toBe(false);
      expect(content.infraStatus).toBe("pass");
      expect(content.consoleErrors).toEqual([
        "[warn] failed to clean Chrome profile /tmp/runstead-ui-chrome-x: ENOTEMPTY"
      ]);
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
