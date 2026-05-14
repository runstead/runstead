import { describe, expect, it } from "vitest";

import { checkDomainPackCompatibility } from "./compatibility.js";

describe("checkDomainPackCompatibility", () => {
  it("accepts versions inside the declared Runstead compatibility range", () => {
    const result = checkDomainPackCompatibility(
      {
        id: "repo-maintenance",
        compatibility: {
          runsteadMinVersion: "0.0.0",
          runsteadMaxVersion: "1.0.0"
        }
      },
      "0.5.0"
    );

    expect(result).toEqual({
      compatible: true,
      issues: []
    });
  });

  it("rejects Runstead versions below the pack minimum", () => {
    const result = checkDomainPackCompatibility(
      {
        id: "future-pack",
        compatibility: {
          runsteadMinVersion: "0.2.0"
        }
      },
      "0.1.9"
    );

    expect(result).toMatchObject({
      compatible: false,
      issues: [
        {
          code: "runstead_version_too_old",
          expected: "0.2.0",
          actual: "0.1.9"
        }
      ]
    });
  });

  it("rejects Runstead versions above the pack maximum", () => {
    const result = checkDomainPackCompatibility(
      {
        id: "legacy-pack",
        compatibility: {
          runsteadMinVersion: "0.0.0",
          runsteadMaxVersion: "0.9.0"
        }
      },
      "1.0.0"
    );

    expect(result).toMatchObject({
      compatible: false,
      issues: [
        {
          code: "runstead_version_too_new",
          expected: "0.9.0",
          actual: "1.0.0"
        }
      ]
    });
  });

  it("treats prerelease versions as lower than their release", () => {
    const result = checkDomainPackCompatibility(
      {
        id: "release-only-pack",
        compatibility: {
          runsteadMinVersion: "1.0.0"
        }
      },
      "1.0.0-beta.1"
    );

    expect(result.issues.map((issue) => issue.code)).toEqual([
      "runstead_version_too_old"
    ]);
  });
});
