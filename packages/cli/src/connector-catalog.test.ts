import { describe, expect, it } from "vitest";

import {
  formatRunsteadConnector,
  formatRunsteadConnectorList,
  getRunsteadConnector,
  listRunsteadConnectors,
  requireRunsteadConnector
} from "./connector-catalog.js";

describe("connector catalog", () => {
  it("lists the canonical provider, communication, web, and docs connectors", () => {
    const connectors = listRunsteadConnectors();

    expect(connectors.map((connector) => connector.id)).toEqual([
      "github",
      "vercel",
      "sentry",
      "posthog",
      "email",
      "web",
      "docs"
    ]);
    expect(connectors.every((connector) => connector.reads.length > 0)).toBe(true);
  });

  it("maps executable startup source providers into the unified catalog", () => {
    expect(getRunsteadConnector("github")?.startupSourceConnectors).toEqual([
      "github_actions",
      "github_pr",
      "github_issue"
    ]);
    expect(getRunsteadConnector("vercel")?.startupSourceConnectors).toEqual([
      "vercel"
    ]);
    expect(getRunsteadConnector("sentry")?.startupSourceConnectors).toEqual([
      "sentry"
    ]);
    expect(getRunsteadConnector("posthog")?.startupSourceConnectors).toEqual([
      "posthog"
    ]);
    expect(getRunsteadConnector("docs")?.startupSourceConnectors).toEqual([
      "docs"
    ]);
  });

  it("keeps draft-only email and web research as catalog contracts", () => {
    expect(getRunsteadConnector("email")).toMatchObject({
      maturity: "catalog",
      writes: ["draft"],
      supportedDomains: ["email-followup"]
    });
    expect(getRunsteadConnector("web")).toMatchObject({
      maturity: "catalog",
      supportedDomains: ["research-monitor"]
    });
  });

  it("formats connector reports for the CLI", () => {
    expect(formatRunsteadConnectorList()).toContain("github   code_hosting");
    expect(formatRunsteadConnector(requireRunsteadConnector("posthog"))).toContain(
      "Evidence types: 2 (startup_measurement_framework, startup_metric_snapshot)"
    );
    expect(() => requireRunsteadConnector("unknown")).toThrow(
      "Connector not found: unknown"
    );
  });
});
