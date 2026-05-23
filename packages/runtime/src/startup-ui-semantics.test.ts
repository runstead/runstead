import { describe, expect, it } from "vitest";

import {
  classifyRuntimeStartupUiValidationFailure,
  runtimeStartupUiValidationInfraStatus,
  runtimeStartupUiValidationRepairHint
} from "./index.js";

describe("@runstead/runtime startup UI semantics", () => {
  it("classifies product, selector, and browser infrastructure failures", () => {
    expect(
      classifyRuntimeStartupUiValidationFailure({
        runner: "browser_flow_smoke",
        responseStatus: 200,
        responseOk: true,
        expectedText: [{ text: "Todo MVP", found: true }],
        flowActions: [
          {
            type: "fill",
            status: "fail",
            summary: "No matching selector found"
          }
        ]
      })
    ).toBe("selector_unstable");
    expect(
      runtimeStartupUiValidationRepairHint({
        runner: "browser_flow_smoke",
        responseStatus: 200,
        responseOk: true,
        expectedText: [{ text: "Todo MVP", found: true }],
        flowActions: [
          {
            type: "fill",
            status: "fail",
            summary: "No matching selector found"
          }
        ]
      })
    ).toContain('data-testid="todo-input"');
    expect(
      runtimeStartupUiValidationInfraStatus({
        runner: "browser_flow_smoke",
        responseStatus: 0,
        responseOk: false,
        expectedText: [],
        error: "Chrome DevTools websocket closed"
      })
    ).toBe("fail");
    expect(
      runtimeStartupUiValidationInfraStatus({
        runner: "browser_flow_smoke",
        responseStatus: 200,
        responseOk: true,
        expectedText: [{ text: "Search", found: false }]
      })
    ).toBe("pass");
  });
});
