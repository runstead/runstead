import { describe, expect, it } from "vitest";

import {
  formatCapabilityBoundaryCatalog,
  getCapabilityBoundary,
  listCapabilityBoundaries
} from "./capability-boundary.js";

describe("capability boundaries", () => {
  it("keeps Runstead capability layers explicit and non-overlapping", () => {
    const boundaries = listCapabilityBoundaries();

    expect(boundaries.map((boundary) => boundary.layer)).toEqual([
      "domain_pack",
      "extension",
      "skill",
      "connector",
      "tool"
    ]);
    expect(getCapabilityBoundary("domain_pack").owns).toContain("evidence contracts");
    expect(getCapabilityBoundary("skill").doNotUseFor).toContain(
      "authoritative evidence collection"
    );
    expect(getCapabilityBoundary("tool").useWhen).toContain(
      "custom auth, payload parsing, streaming, or binary handling is required"
    );
  });

  it("formats the catalog for docs and operator surfaces", () => {
    const report = formatCapabilityBoundaryCatalog();

    expect(report).toContain("Runstead capability boundaries");
    expect(report).toContain("domain_pack: owns=business workflow shape");
    expect(report).toContain(
      "connector: owns=canonical external or workspace source identity"
    );
  });

  it("returns defensive copies", () => {
    const boundary = getCapabilityBoundary("extension");

    boundary.owns.push("mutated");

    expect(getCapabilityBoundary("extension").owns).not.toContain("mutated");
  });
});
