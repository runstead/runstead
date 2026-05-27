import type { StartupReadyUiSmokeConfig } from "./startup-ready-ui-smoke-config.js";
import { inferStartupReadyUiSmokeExpectText } from "./startup-ready-ui-smoke-expect-text.js";
import {
  hasStartupReadyStaticTodoScaffold,
  inferStartupReadyUiSmokeFlowActions,
  startupReadyMobileNoOverlapActions
} from "./startup-ready-ui-smoke-flow.js";

export const DEFAULT_UI_SMOKE_TIMEOUT_MS = 20_000;

export async function defaultStartupReadyUiSmokeConfig(
  cwd: string,
  command: string
): Promise<StartupReadyUiSmokeConfig> {
  const expectText = await inferStartupReadyUiSmokeExpectText(cwd);
  const steps = await inferStartupReadyUiSmokeFlowActions(cwd);
  const staticTodo = await hasStartupReadyStaticTodoScaffold(cwd);
  const mobileSteps = staticTodo ? startupReadyMobileNoOverlapActions() : [];

  return {
    schemaVersion: 1,
    server: {
      command,
      port: 3000,
      url: "http://127.0.0.1:3000",
      timeoutMs: DEFAULT_UI_SMOKE_TIMEOUT_MS
    },
    checks: [
      {
        name: steps.length === 0 ? "home-desktop" : "home-desktop-product-flow",
        url: "http://127.0.0.1:3000",
        viewport: "desktop",
        expectText,
        flow:
          steps.length === 0
            ? "load the primary product route"
            : staticTodo
              ? "todo workflow: add, edit, complete, search/filter, delete, clear completed, reload persistence"
              : "todo golden path: add, toggle, search/filter, reload persistence",
        ...(steps.length === 0 ? {} : { steps })
      },
      {
        name: mobileSteps.length === 0 ? "home-mobile" : "home-mobile-product-layout",
        url: "http://127.0.0.1:3000",
        viewport: "mobile",
        expectText,
        flow:
          mobileSteps.length === 0
            ? "load the primary product route on mobile viewport"
            : "mobile layout: no overlapping todo controls",
        ...(mobileSteps.length === 0 ? {} : { steps: mobileSteps })
      }
    ]
  };
}
