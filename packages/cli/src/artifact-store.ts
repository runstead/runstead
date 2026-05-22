import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import type { JsonObject } from "@runstead/core";

export interface WriteArtifactFileOptions {
  artifactPath: string;
  contents: string | Buffer;
  contentType: string;
  createdAt: string;
  metadata?: JsonObject;
}

export interface ArtifactManifest {
  schemaVersion: 1;
  artifactPath: string;
  artifactUri: string;
  contentType: string;
  sha256: string;
  sizeBytes: number;
  createdAt: string;
  committedAt: string;
  metadata?: JsonObject;
}

export interface WriteArtifactFileResult {
  artifactPath: string;
  artifactUri: string;
  manifestPath: string;
  manifestUri: string;
  sha256: string;
  sizeBytes: number;
  manifest: ArtifactManifest;
}

export async function writeJsonArtifactFile(options: {
  artifactPath: string;
  value: unknown;
  createdAt: string;
  metadata?: JsonObject;
}): Promise<WriteArtifactFileResult & { contents: string }> {
  const contents = `${JSON.stringify(options.value, null, 2)}\n`;
  const result = await writeArtifactFile({
    artifactPath: options.artifactPath,
    contents,
    contentType: "application/json",
    createdAt: options.createdAt,
    ...(options.metadata === undefined ? {} : { metadata: options.metadata })
  });

  return {
    ...result,
    contents
  };
}

export async function writeArtifactFile(
  options: WriteArtifactFileOptions
): Promise<WriteArtifactFileResult> {
  const artifactPath = options.artifactPath;
  const artifactUri = pathToFileURL(artifactPath).href;
  const contents = Buffer.isBuffer(options.contents)
    ? options.contents
    : Buffer.from(options.contents, "utf8");
  const sha256 = createHash("sha256").update(contents).digest("hex");
  const sizeBytes = contents.byteLength;
  const manifestPath = `${artifactPath}.manifest.json`;
  const manifestUri = pathToFileURL(manifestPath).href;
  const committedAt = new Date().toISOString();
  const manifest: ArtifactManifest = {
    schemaVersion: 1,
    artifactPath,
    artifactUri,
    contentType: options.contentType,
    sha256,
    sizeBytes,
    createdAt: options.createdAt,
    committedAt,
    ...(options.metadata === undefined ? {} : { metadata: options.metadata })
  };

  await mkdir(dirname(artifactPath), { recursive: true });
  await writeFileAtomically(artifactPath, contents);
  await writeFileAtomically(
    manifestPath,
    Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8")
  );

  return {
    artifactPath,
    artifactUri,
    manifestPath,
    manifestUri,
    sha256,
    sizeBytes,
    manifest
  };
}

async function writeFileAtomically(
  targetPath: string,
  contents: Buffer
): Promise<void> {
  const tempPath = join(
    dirname(targetPath),
    `.${basename(targetPath)}.${process.pid}.${randomUUID()}.tmp`
  );
  const handle = await open(tempPath, "wx");
  let closed = false;

  try {
    await handle.writeFile(contents);
    await handle.sync();
    await handle.close();
    closed = true;
    await rename(tempPath, targetPath);
  } catch (error) {
    if (!closed) {
      await handle.close().catch(() => undefined);
    }

    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}
