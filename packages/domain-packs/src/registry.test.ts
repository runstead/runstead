import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { listDomainPacks, resolveDomainPackRef } from "./registry.js";
import { createDomainPackTemplate } from "./template.js";

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

  it("reports duplicate pack ids across registry sources", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-pack-registry-"));

    try {
      const duplicateRoot = join(workspace, "repo-maintenance-copy");

      await createDomainPackTemplate({
        id: "repo-maintenance",
        outputDir: duplicateRoot
      });

      const registry = await listDomainPacks({
        roots: [workspace]
      });

      expect(registry.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            severity: "error",
            code: "domain_pack_duplicate_id",
            message: "Duplicate domain pack id found in registry: repo-maintenance"
          })
        ])
      );
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("excludes invalid workspace packs with validator issues", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-pack-invalid-"));

    try {
      const invalidRoot = join(workspace, "broken-pack");

      await mkdir(invalidRoot, { recursive: true });
      await writeFile(
        join(invalidRoot, "domain.yaml"),
        [
          "id: broken-pack",
          "version: 0.1.0",
          "name: Broken Pack",
          "description: Invalid registry test pack.",
          "goal_templates: []",
          "task_types: []",
          "default_policy: policies/default.yaml",
          "default_verifiers: []",
          "required_tools: []",
          "supported_workers: []"
        ].join("\n"),
        "utf8"
      );

      const registry = await listDomainPacks({
        includeBuiltIns: false,
        roots: [workspace]
      });

      expect(registry.entries.map((entry) => entry.id)).not.toContain("broken-pack");
      expect(registry.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            severity: "error",
            code: "default_policy_missing"
          })
        ])
      );
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});
