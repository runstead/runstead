import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { listDomainPacks, resolveDomainPackRef } from "./registry.js";

describe("domain pack registry", () => {
  it("lists built-in domain packs", async () => {
    const registry = await listDomainPacks();

    expect(registry.issues).toEqual([]);
    expect(registry.entries.map((entry) => entry.id)).toContain("repo-maintenance");
    expect(registry.entries.map((entry) => entry.id)).toContain("research-monitor");
    expect(registry.entries.map((entry) => entry.id)).toContain("email-followup");
    expect(
      registry.entries.find((entry) => entry.id === "repo-maintenance")?.source
    ).toBe("built_in");
  });

  it("discovers workspace domain pack roots", async () => {
    const packsRoot = fileURLToPath(new URL("../packs", import.meta.url));

    const registry = await listDomainPacks({
      includeBuiltIns: false,
      roots: [packsRoot]
    });

    expect(registry.issues).toEqual([]);
    expect(registry.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "repo-maintenance",
          source: "workspace"
        }),
        expect.objectContaining({
          id: "research-monitor",
          source: "workspace"
        }),
        expect.objectContaining({
          id: "email-followup",
          source: "workspace"
        })
      ])
    );
  });

  it("resolves domain pack refs by id and path", async () => {
    const packsRoot = fileURLToPath(new URL("../packs", import.meta.url));
    const packRoot = fileURLToPath(
      new URL("../packs/repo-maintenance", import.meta.url)
    );

    await expect(
      resolveDomainPackRef("repo-maintenance", {
        includeBuiltIns: false,
        roots: [packsRoot]
      })
    ).resolves.toMatchObject({
      id: "repo-maintenance",
      source: "workspace"
    });
    await expect(
      resolveDomainPackRef(packRoot, {
        includeBuiltIns: false
      })
    ).resolves.toMatchObject({
      id: "repo-maintenance",
      source: "path"
    });
  });
});
