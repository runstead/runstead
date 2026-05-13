import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  loadDomainPackFromFile,
  parseDomainPack,
  repoMaintenancePack
} from "./index.js";

describe("repo-maintenance pack", () => {
  it("matches the DomainPack contract", () => {
    expect(parseDomainPack(repoMaintenancePack).id).toBe("repo-maintenance");
  });

  it("loads and validates the built-in domain.yaml", async () => {
    const domainPath = fileURLToPath(
      new URL("../packs/repo-maintenance/domain.yaml", import.meta.url)
    );

    const pack = await loadDomainPackFromFile(domainPath);

    expect(pack).toMatchObject({
      id: "repo-maintenance",
      goalTemplates: ["keep-ci-green"],
      taskTypes: ["repo_inspect", "run_local_verifiers", "ci_repair"],
      defaultPolicy: "policies/repo-maintenance.yaml"
    });
    expect(pack.security?.protectedPaths).toContain(".env");
    expect(pack.security?.protectedPaths).toContain("infra/prod/**");
  });
});
