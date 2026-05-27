import { describe, expect, it } from "vitest";

import {
  normalizeRuntimeStartupUiSmokeConfig,
  parseRuntimeStartupUiSmokeSteps
} from "./startup-ui-smoke-config.js";

describe("startup UI smoke config runtime contract", () => {
  it("normalizes canonical config objects", () => {
    const result = normalizeRuntimeStartupUiSmokeConfig({
      schemaVersion: 1,
      server: {
        command: "npm run dev",
        port: 3000,
        timeoutMs: 20_000
      },
      checks: [
        {
          name: "home",
          viewports: ["desktop", "mobile"],
          expectText: ["Todo", "Add task"],
          steps: [
            {
              fill: {
                selectors: ["[data-testid='todo-input']"],
                value: "Runstead smoke todo"
              }
            },
            {
              type: "expectPersisted",
              text: "Runstead smoke todo"
            }
          ]
        }
      ]
    });

    expect(result.warnings).toEqual([]);
    expect(result.config.server).toEqual({
      command: "npm run dev",
      port: 3000,
      timeoutMs: 20_000
    });
    expect(result.config.checks).toHaveLength(2);
    expect(result.config.checks[0]).toMatchObject({
      name: "home-desktop",
      viewport: "desktop",
      expectText: ["Todo", "Add task"]
    });
    expect(result.config.checks[0]?.steps).toEqual([
      {
        type: "fill",
        selectors: ["[data-testid='todo-input']"],
        value: "Runstead smoke todo"
      },
      {
        type: "expectPersisted",
        text: "Runstead smoke todo"
      }
    ]);
  });

  it("normalizes legacy startup and check shapes", () => {
    const result = normalizeRuntimeStartupUiSmokeConfig(
      {
        startup: {
          run: "npm run dev",
          readyWhen: {
            url: "http://127.0.0.1:5173"
          }
        },
        checks: [
          {
            name: "legacy",
            request: {
              url: "http://127.0.0.1:5173/dashboard"
            },
            expect: {
              bodyContains: ["Dashboard"],
              text: "Add task"
            }
          }
        ]
      },
      ".runstead/startup/ui-smoke.yaml"
    );

    expect(result.warnings).toEqual([
      "legacy UI smoke config shape was auto-normalized"
    ]);
    expect(result.repairHints).toHaveLength(1);
    expect(result.config.server).toEqual({
      command: "npm run dev",
      port: 5173,
      url: "http://127.0.0.1:5173"
    });
    expect(result.config.checks).toEqual([
      {
        name: "legacy",
        url: "http://127.0.0.1:5173/dashboard",
        expectText: ["Dashboard", "Add task"]
      }
    ]);
  });

  it("rejects invalid flow steps before execution", () => {
    expect(() =>
      parseRuntimeStartupUiSmokeSteps([
        {
          type: "expectNoOverlap"
        }
      ])
    ).toThrow(
      "UI smoke expectNoOverlap selectors 1 must include at least one selector"
    );
  });
});
