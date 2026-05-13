import { describe, expect, it } from "vitest";

import { parseDomainPack, repoMaintenancePack } from "./index.js";

describe("repo-maintenance pack", () => {
  it("matches the DomainPack contract", () => {
    expect(parseDomainPack(repoMaintenancePack).id).toBe("repo-maintenance");
  });
});
