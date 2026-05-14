import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildDomainPackBundle,
  extractDomainPackBundle,
  serializeDomainPackBundle,
  type DomainPackBundleArtifact
} from "./bundle.js";
import { createDomainPackTemplate } from "./template.js";
import { validateDomainPackDir } from "./validator.js";
import { verifyDomainPackManifest } from "./manifest.js";

describe("domain pack bundles", () => {
  it("builds and extracts a deterministic bundle with a manifest", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-domain-bundle-"));

    try {
      const template = await createDomainPackTemplate({
        id: "customer-ops",
        outputDir: join(workspace, "customer-ops")
      });
      const bundle = await buildDomainPackBundle(template.root);
      const serialized = serializeDomainPackBundle(bundle);
      const outputDir = join(workspace, "extracted");
      const extracted = await extractDomainPackBundle({
        bundle: JSON.parse(serialized) as unknown,
        outputDir
      });
      const validation = await validateDomainPackDir(outputDir);
      const verification = await verifyDomainPackManifest(outputDir);
      const storedManifest = JSON.parse(
        await readFile(extracted.manifestPath, "utf8")
      ) as typeof bundle.manifest;

      expect(bundle.manifest.domain.id).toBe("customer-ops");
      expect(bundle.files.map((file) => file.path)).toEqual(
        bundle.manifest.files.map((file) => file.path)
      );
      expect(extracted.files).toEqual(bundle.manifest.files.map((file) => file.path));
      expect(storedManifest.domain).toEqual(bundle.manifest.domain);
      expect(validation.valid).toBe(true);
      expect(verification.valid).toBe(true);
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("rejects tampered bundle contents", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-domain-bundle-"));

    try {
      const template = await createDomainPackTemplate({
        id: "customer-ops",
        outputDir: join(workspace, "customer-ops")
      });
      const bundle = await buildDomainPackBundle(template.root);
      const first = bundle.files[0];

      if (first === undefined) {
        throw new Error("Expected bundle file");
      }

      const tamperedContents = Buffer.from(first.contentsBase64, "base64");
      const firstByte = tamperedContents[0];

      if (firstByte === undefined) {
        throw new Error("Expected bundle contents");
      }

      tamperedContents[0] = firstByte === 65 ? 66 : 65;

      await expect(
        extractDomainPackBundle({
          bundle: {
            ...bundle,
            files: [
              {
                ...first,
                contentsBase64: tamperedContents.toString("base64")
              },
              ...bundle.files.slice(1)
            ]
          },
          outputDir: join(workspace, "tampered")
        })
      ).rejects.toThrow("hash mismatch");
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("rejects bundle paths that escape the package", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-domain-bundle-"));

    try {
      const template = await createDomainPackTemplate({
        id: "customer-ops",
        outputDir: join(workspace, "customer-ops")
      });
      const bundle = await buildDomainPackBundle(template.root);
      const firstFile = bundle.files[0];
      const firstManifestFile = bundle.manifest.files[0];

      if (firstFile === undefined || firstManifestFile === undefined) {
        throw new Error("Expected bundle file");
      }

      await expect(
        extractDomainPackBundle({
          bundle: {
            ...bundle,
            manifest: {
              ...bundle.manifest,
              files: [
                {
                  ...firstManifestFile,
                  path: "../domain.yaml"
                },
                ...bundle.manifest.files.slice(1)
              ]
            },
            files: [
              {
                ...firstFile,
                path: "../domain.yaml"
              },
              ...bundle.files.slice(1)
            ]
          },
          outputDir: join(workspace, "escaped")
        })
      ).rejects.toThrow("escapes the package");
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("rejects extracted packs that do not verify against the bundled manifest", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-domain-bundle-"));

    try {
      const template = await createDomainPackTemplate({
        id: "customer-ops",
        outputDir: join(workspace, "customer-ops"),
        name: "Customer Ops"
      });
      const bundle = await buildDomainPackBundle(template.root);
      const domainYaml = await readFile(join(template.root, "domain.yaml"), "utf8");
      const driftedBundle = replaceBundleFileContents(
        bundle,
        "domain.yaml",
        domainYaml.replace('name: "Customer Ops"', 'name: "Customer Ops Drift"')
      );

      await expect(
        extractDomainPackBundle({
          bundle: driftedBundle,
          outputDir: join(workspace, "drifted")
        })
      ).rejects.toThrow("manifest verification failed");
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});

function replaceBundleFileContents(
  bundle: DomainPackBundleArtifact,
  path: string,
  contents: string
): DomainPackBundleArtifact {
  const bytes = Buffer.byteLength(contents, "utf8");
  const sha256 = createHash("sha256").update(contents).digest("hex");
  const updateFile = <T extends { path: string; bytes: number; sha256: string }>(
    file: T
  ): T =>
    file.path === path
      ? {
          ...file,
          bytes,
          sha256,
          ...("contentsBase64" in file
            ? { contentsBase64: Buffer.from(contents).toString("base64") }
            : {})
        }
      : file;

  return {
    ...bundle,
    manifest: {
      ...bundle.manifest,
      files: bundle.manifest.files.map(updateFile)
    },
    files: bundle.files.map(updateFile)
  };
}
