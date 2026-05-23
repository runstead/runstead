import { describe, expect, it } from "vitest";

import {
  CommandVerifierInputSchema,
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
});
