import { describe, expect, it } from "vitest";

import {
  CommandVerifierInputSchema,
  commandVerifierResultPassed,
  commandVerifierResultsPassed,
  defineCommandVerifier,
  isStandardVerifierName
} from "./index.js";

describe("verifier command contracts", () => {
  it("accepts command verifier inputs", () => {
    expect(
      defineCommandVerifier({
        name: "test",
        command: "pnpm test"
      })
    ).toEqual({
      name: "test",
      command: "pnpm test"
    });
  });

  it("rejects empty verifier commands", () => {
    expect(() =>
      CommandVerifierInputSchema.parse({
        name: "test",
        command: ""
      })
    ).toThrow();
  });

  it("identifies standard verifier names", () => {
    expect(isStandardVerifierName("typecheck")).toBe(true);
    expect(isStandardVerifierName("storybook")).toBe(false);
  });

  it("classifies verifier command results without CLI imports", () => {
    const passed = {
      verifier: "test",
      exitCode: 0,
      timedOut: false,
      forceKilled: false,
      evidenceId: "ev_test"
    };
    const failed = {
      verifier: "lint",
      exitCode: 1,
      timedOut: false,
      forceKilled: false,
      evidenceId: "ev_lint"
    };

    expect(commandVerifierResultPassed(passed)).toBe(true);
    expect(commandVerifierResultPassed(failed)).toBe(false);
    expect(commandVerifierResultsPassed([passed])).toBe(true);
    expect(commandVerifierResultsPassed([passed, failed])).toBe(false);
  });
});
