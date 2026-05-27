import { describe, expect, it } from "vitest";

import { parseRepositoryStatus } from "./repo-read-actions.js";

describe("parseRepositoryStatus", () => {
  it("accepts known repository statuses", () => {
    expect(parseRepositoryStatus("active")).toBe("active");
    expect(parseRepositoryStatus("archived")).toBe("archived");
  });

  it("treats an omitted status as no filter", () => {
    expect(parseRepositoryStatus(undefined)).toBeUndefined();
  });

  it("rejects unknown statuses", () => {
    expect(() => parseRepositoryStatus("deleted")).toThrow(
      "--status must be active or archived"
    );
  });
});
