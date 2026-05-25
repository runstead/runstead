import { describe, expect, it } from "vitest";

import {
  collectValues,
  emptyAsUndefined,
  parseLocalAgentWorker,
  parsePositiveInteger,
  parseStartupAssessStages,
  parseStartupGateDecision,
  parseStartupGateStage,
  parseStartupHypothesisKind,
  parseStartupHypothesisStatus,
  parseStartupInitStage,
  requireUiValidationUrl
} from "./startup-command-parsers.js";

describe("startup command parsers", () => {
  it("parses startup stage and decision options", () => {
    expect(parseStartupGateStage("idea")).toBe("idea");
    expect(parseStartupGateStage("launch")).toBe("launch");
    expect(parseStartupGateDecision("launch_with_accepted_debt")).toBe(
      "launch_with_accepted_debt"
    );
    expect(parseStartupAssessStages("all")).toEqual(["mvp", "launch", "scale"]);
    expect(parseStartupAssessStages("scale")).toEqual(["scale"]);
    expect(parseStartupInitStage("mvp")).toBe("mvp");
  });

  it("parses worker and hypothesis options", () => {
    expect(parseLocalAgentWorker("codex_direct")).toBe("codex_direct");
    expect(parseStartupHypothesisKind("solution")).toBe("solution");
    expect(parseStartupHypothesisStatus("needs-more-evidence")).toBe(
      "needs-more-evidence"
    );
  });

  it("normalizes repeated values and required numeric/url options", () => {
    expect(collectValues("two", ["one"])).toEqual(["one", "two"]);
    expect(emptyAsUndefined([])).toBeUndefined();
    expect(emptyAsUndefined(["one"])).toEqual(["one"]);
    expect(parsePositiveInteger("3", "--max-attempts")).toBe(3);
    expect(requireUiValidationUrl("http://127.0.0.1:3000")).toBe(
      "http://127.0.0.1:3000"
    );
  });

  it("rejects invalid option values with command-oriented messages", () => {
    expect(() => parseStartupGateStage("production")).toThrow(
      "--stage must be one of: idea, mvp, launch, scale"
    );
    expect(() => parseStartupGateDecision("ship")).toThrow(
      "--decision must be one of: launch, no_launch, launch_with_accepted_debt"
    );
    expect(() => parseStartupAssessStages("idea")).toThrow(
      "--stage must be one of: all, mvp, launch, scale"
    );
    expect(() => parseStartupInitStage("idea")).toThrow(
      "--stage must be one of: mvp, launch, scale"
    );
    expect(() => parseStartupHypothesisKind("market")).toThrow(
      "--kind must be one of: problem, user, solution"
    );
    expect(() => parseStartupHypothesisStatus("done")).toThrow(
      "--status must be one of: open, validated, invalidated, needs-more-evidence"
    );
    expect(() => parseLocalAgentWorker("shell")).toThrow(
      "--worker must be one of: codex_direct, codex_cli, claude_code"
    );
    expect(() => parsePositiveInteger("0", "--max-attempts")).toThrow(
      "--max-attempts must be a positive integer"
    );
    expect(() => requireUiValidationUrl(undefined)).toThrow(
      "--url is required unless --execute starts a dev server"
    );
  });
});
