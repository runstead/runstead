import { describe, expect, it } from "vitest";

import {
  agentReportOutputFormat,
  formatAgentReportOutput
} from "./agent-report-output.js";

describe("agent report output", () => {
  it("selects the requested output format", () => {
    expect(agentReportOutputFormat({})).toBe("text");
    expect(agentReportOutputFormat({ json: true })).toBe("json");
    expect(agentReportOutputFormat({ markdown: true })).toBe("markdown");
  });

  it("rejects conflicting report output formats", () => {
    expect(() => agentReportOutputFormat({ json: true, markdown: true })).toThrow(
      "agent report accepts only one of --json or --markdown"
    );
  });

  it("renders only the selected output branch", () => {
    expect(
      formatAgentReportOutput("json", {
        text: () => {
          throw new Error("unexpected text renderer");
        },
        json: () => "{ }\n",
        markdown: () => {
          throw new Error("unexpected markdown renderer");
        }
      })
    ).toBe("{ }");
  });
});
