import { describe, expect, it } from "vitest";

import { agentBudgetTaskOptions } from "./agent-budget-options.js";

describe("agentBudgetTaskOptions", () => {
  it("uses preset defaults when no CLI override is provided", () => {
    expect(
      agentBudgetTaskOptions(
        {},
        {
          maxTurns: 10,
          maxToolCalls: 20,
          maxFailedToolCalls: 3
        }
      )
    ).toEqual({
      maxTurns: 10,
      maxToolCalls: 20,
      maxFailedToolCalls: 3
    });
  });

  it("lets CLI overrides replace defaults", () => {
    expect(
      agentBudgetTaskOptions(
        {
          maxTurns: "11",
          maxToolCalls: "21",
          maxFailedToolCalls: "4"
        },
        {
          maxTurns: 10,
          maxToolCalls: 20,
          maxFailedToolCalls: 3
        }
      )
    ).toEqual({
      maxTurns: 11,
      maxToolCalls: 21,
      maxFailedToolCalls: 4
    });
  });

  it("omits unset budget fields when no defaults exist", () => {
    expect(agentBudgetTaskOptions({})).toEqual({});
  });
});
