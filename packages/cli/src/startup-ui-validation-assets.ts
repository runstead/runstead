import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { requireRunsteadStateDb } from "./runstead-root.js";
import type { StartupDevServerHandle } from "./startup-dev-server.js";
import type { StartupEvidenceSourceInput } from "./startup-evidence.js";

export async function persistStartupUiScreenshot(input: {
  cwd?: string;
  screenshot?: string;
}): Promise<{ uri: string; originalUri: string; hash: string } | undefined> {
  if (input.screenshot === undefined) {
    return undefined;
  }

  const sourcePath = localScreenshotPath(input.screenshot, input.cwd);

  if (sourcePath === undefined) {
    return undefined;
  }

  try {
    const sourceStat = await stat(sourcePath);

    if (!sourceStat.isFile()) {
      return undefined;
    }
  } catch {
    return undefined;
  }

  const cwd = resolve(input.cwd ?? process.cwd());
  const state = await requireRunsteadStateDb(cwd);
  const contents = await readFile(sourcePath);
  const hash = sha256(contents);
  const assetsDir = join(state.root, "evidence", "assets");
  const sourceBaseName = basename(sourcePath);
  const targetName = sourceBaseName.startsWith(`${hash.slice(0, 12)}-`)
    ? sourceBaseName
    : `${hash.slice(0, 12)}-${sourceBaseName}`;
  const targetPath = join(assetsDir, targetName);

  if (resolve(sourcePath) !== resolve(targetPath)) {
    await mkdir(assetsDir, { recursive: true });
    await copyFile(sourcePath, targetPath);
  }

  return {
    uri: pathToFileURL(targetPath).href,
    originalUri: input.screenshot,
    hash: `sha256:${hash}`
  };
}

export async function persistStartupUiTextAsset(input: {
  cwd: string;
  prefix: string;
  extension: string;
  contents: string;
}): Promise<{ uri: string; hash: string }> {
  const state = await requireRunsteadStateDb(input.cwd);
  const hash = sha256(Buffer.from(input.contents));
  const assetsDir = join(state.root, "evidence", "assets");
  const targetPath = join(
    assetsDir,
    `${hash.slice(0, 12)}-${input.prefix}.${input.extension}`
  );

  await mkdir(assetsDir, { recursive: true });
  await writeFile(targetPath, input.contents, "utf8");

  return {
    uri: pathToFileURL(targetPath).href,
    hash: `sha256:${hash}`
  };
}

export async function persistStartupUiBinaryAsset(input: {
  cwd: string;
  prefix: string;
  extension: string;
  contents: Buffer;
}): Promise<{ uri: string; hash: string }> {
  const state = await requireRunsteadStateDb(input.cwd);
  const hash = sha256(input.contents);
  const assetsDir = join(state.root, "evidence", "assets");
  const targetPath = join(
    assetsDir,
    `${hash.slice(0, 12)}-${input.prefix}.${input.extension}`
  );

  await mkdir(assetsDir, { recursive: true });
  await writeFile(targetPath, input.contents);

  return {
    uri: pathToFileURL(targetPath).href,
    hash: `sha256:${hash}`
  };
}

export async function persistConsoleLogAsset(
  cwd: string,
  messages: string[]
): Promise<{ uri: string; hash: string } | undefined> {
  if (messages.length === 0) {
    return undefined;
  }

  return persistStartupUiTextAsset({
    cwd,
    prefix: "console",
    extension: "log",
    contents: `${messages.join("\n")}\n`
  });
}

export async function persistServerLogAsset(
  cwd: string,
  server: StartupDevServerHandle | undefined
): Promise<{ uri: string; hash: string } | undefined> {
  const logs = server?.logs();

  if (
    logs === undefined ||
    (logs.stdout.trim().length === 0 && logs.stderr.trim().length === 0)
  ) {
    return undefined;
  }

  return persistStartupUiTextAsset({
    cwd,
    prefix: "server",
    extension: "log",
    contents: [
      "# stdout",
      logs.stdout.trimEnd(),
      "",
      "# stderr",
      logs.stderr.trimEnd(),
      ""
    ].join("\n")
  });
}

function localScreenshotPath(screenshot: string, cwd?: string): string | undefined {
  if (screenshot.startsWith("file://")) {
    return fileURLToPath(screenshot);
  }

  if (screenshot.startsWith("file:")) {
    return undefined;
  }

  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(screenshot)) {
    return undefined;
  }

  return resolve(cwd ?? process.cwd(), screenshot);
}

export function startupUiExecutionSources(
  domAsset: { uri: string; hash: string },
  screenshotAsset: { uri: string; hash: string } | undefined,
  consoleAsset: { uri: string; hash: string } | undefined,
  serverLogAsset: { uri: string; hash: string } | undefined
): StartupEvidenceSourceInput[] {
  return [
    {
      kind: "browser_ui",
      uri: domAsset.uri,
      hash: domAsset.hash
    },
    ...(screenshotAsset === undefined
      ? []
      : [
          {
            kind: "browser_ui",
            uri: screenshotAsset.uri,
            hash: screenshotAsset.hash
          }
        ]),
    ...(consoleAsset === undefined
      ? []
      : [
          {
            kind: "browser_ui",
            uri: consoleAsset.uri,
            hash: consoleAsset.hash
          }
        ]),
    ...(serverLogAsset === undefined
      ? []
      : [
          {
            kind: "command_output",
            uri: serverLogAsset.uri,
            hash: serverLogAsset.hash
          }
        ])
  ];
}

function sha256(contents: Buffer): string {
  return createHash("sha256").update(contents).digest("hex");
}
