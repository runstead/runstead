import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { requireRunsteadStateDb } from "./runstead-root.js";
import {
  startStartupDevServer,
  type StartupDevServerHandle
} from "./startup-dev-server.js";
import {
  addStartupEvidence,
  type AddStartupEvidenceResult,
  type StartupEvidenceSourceInput
} from "./startup-evidence.js";

export type StartupUiValidationStatus = "pass" | "fail" | "not_run";

export interface RecordStartupUiValidationOptions {
  cwd?: string;
  url: string;
  viewport: string;
  screenshot?: string;
  domStatus?: StartupUiValidationStatus;
  accessibilityStatus?: StartupUiValidationStatus;
  responsiveStatus?: StartupUiValidationStatus;
  criticalFlow?: string;
  criticalFlowStatus?: StartupUiValidationStatus;
  domArtifact?: string;
  consoleErrors?: string[];
  execution?: StartupUiValidationExecutionEvidence;
  sourceRefs?: string[];
  sources?: StartupEvidenceSourceInput[];
  goalId?: string;
  now?: Date;
}

export interface RecordStartupUiValidationResult {
  evidence: AddStartupEvidenceResult;
  failed: boolean;
}

export interface ExecuteStartupUiValidationOptions {
  cwd?: string;
  url?: string;
  viewport: string;
  criticalFlow?: string;
  expectText?: string[];
  serverCommand?: string;
  serverPort?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  goalId?: string;
  now?: Date;
}

export interface ExecuteStartupUiValidationResult extends RecordStartupUiValidationResult {
  url: string;
  domArtifact: string;
  execution: StartupUiValidationExecutionEvidence;
}

export interface StartupUiValidationExecutionEvidence {
  runner: "http_dom_smoke";
  responseStatus: number;
  responseOk: boolean;
  expectedText: StartupUiValidationTextCheck[];
  server?: StartupUiValidationServerEvidence;
}

export interface StartupUiValidationTextCheck {
  text: string;
  found: boolean;
}

export interface StartupUiValidationServerEvidence {
  managed: boolean;
  command: string;
  url: string;
  port: number;
}

export async function recordStartupUiValidation(
  options: RecordStartupUiValidationOptions
): Promise<RecordStartupUiValidationResult> {
  const persistedScreenshot = await persistStartupUiScreenshot({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    ...(options.screenshot === undefined ? {} : { screenshot: options.screenshot })
  });
  const screenshot = persistedScreenshot?.uri ?? options.screenshot;
  const content = {
    url: options.url,
    viewport: options.viewport,
    ...(screenshot === undefined ? {} : { screenshot }),
    ...(persistedScreenshot?.originalUri === undefined
      ? {}
      : { originalScreenshot: persistedScreenshot.originalUri }),
    domStatus: options.domStatus ?? "not_run",
    accessibilityStatus: options.accessibilityStatus ?? "not_run",
    responsiveStatus: options.responsiveStatus ?? "not_run",
    ...(options.criticalFlow === undefined
      ? {}
      : { criticalFlow: options.criticalFlow }),
    criticalFlowStatus: options.criticalFlowStatus ?? "not_run",
    ...(options.domArtifact === undefined ? {} : { domArtifact: options.domArtifact }),
    ...(options.consoleErrors === undefined
      ? {}
      : { consoleErrors: options.consoleErrors }),
    ...(options.execution === undefined ? {} : { execution: options.execution })
  };
  const failed = uiValidationFailed(content);
  const sourceRefs = [
    ...(options.sourceRefs ?? []),
    ...(screenshot === undefined ? [] : [screenshot])
  ];
  const sources =
    options.sources ??
    (screenshot === undefined
      ? undefined
      : [
          {
            kind: "browser_ui",
            uri: screenshot,
            ...(persistedScreenshot?.hash === undefined
              ? {}
              : { hash: persistedScreenshot.hash })
          }
        ]);
  const evidence = await addStartupEvidence({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    type: "ui_validation",
    summary: `UI validation ${failed ? "failed" : "recorded"} for ${options.url} ${options.viewport}`,
    sourceRefs,
    ...(sources === undefined ? {} : { sources }),
    content: JSON.stringify(content, null, 2),
    gate: "launch",
    ...(options.goalId === undefined ? {} : { goalId: options.goalId }),
    ...(options.now === undefined ? {} : { now: options.now })
  });

  return {
    evidence,
    failed
  };
}

export async function executeStartupUiValidation(
  options: ExecuteStartupUiValidationOptions
): Promise<ExecuteStartupUiValidationResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  let server: StartupDevServerHandle | undefined;

  try {
    if (options.serverCommand !== undefined || options.url === undefined) {
      server = await startStartupDevServer({
        cwd,
        ...(options.serverCommand === undefined
          ? {}
          : { command: options.serverCommand }),
        ...(options.url === undefined ? {} : { url: options.url }),
        ...(options.serverPort === undefined ? {} : { port: options.serverPort }),
        timeoutMs: options.timeoutMs ?? 20_000,
        ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl })
      });
    }

    const url = server?.url ?? options.url;

    if (url === undefined) {
      throw new Error("UI validation execution requires a URL or a dev server command");
    }

    const response = await (options.fetchImpl ?? fetch)(url);
    const html = await response.text();
    const domAsset = await persistStartupUiTextAsset({
      cwd,
      prefix: "dom",
      extension: "html",
      contents: html
    });
    const expectedText = (options.expectText ?? []).map((text) => ({
      text,
      found: html.includes(text)
    }));
    const domStatus = executedDomStatus(response, html, expectedText);
    const accessibilityStatus = executedAccessibilityStatus(html);
    const responsiveStatus = executedResponsiveStatus(options.viewport);
    const criticalFlowStatus =
      options.criticalFlow === undefined ? "not_run" : domStatus;
    const execution: StartupUiValidationExecutionEvidence = {
      runner: "http_dom_smoke",
      responseStatus: response.status,
      responseOk: response.ok,
      expectedText,
      ...(server === undefined
        ? {}
        : {
            server: {
              managed: server.managed,
              command: server.command,
              url: server.url,
              port: server.port
            }
          })
    };
    const recorded = await recordStartupUiValidation({
      cwd,
      url,
      viewport: options.viewport,
      domStatus,
      accessibilityStatus,
      responsiveStatus,
      ...(options.criticalFlow === undefined
        ? {}
        : { criticalFlow: options.criticalFlow }),
      criticalFlowStatus,
      domArtifact: domAsset.uri,
      consoleErrors: [],
      execution,
      sources: [
        {
          kind: "browser_ui",
          uri: domAsset.uri,
          hash: domAsset.hash
        }
      ],
      ...(options.goalId === undefined ? {} : { goalId: options.goalId }),
      ...(options.now === undefined ? {} : { now: options.now })
    });

    return {
      ...recorded,
      url,
      domArtifact: domAsset.uri,
      execution
    };
  } finally {
    await server?.stop();
  }
}

async function persistStartupUiScreenshot(input: {
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
  const targetPath = join(assetsDir, `${hash.slice(0, 12)}-${basename(sourcePath)}`);

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

async function persistStartupUiTextAsset(input: {
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

function sha256(contents: Buffer): string {
  return createHash("sha256").update(contents).digest("hex");
}

function executedDomStatus(
  response: Response,
  html: string,
  expectedText: StartupUiValidationTextCheck[]
): StartupUiValidationStatus {
  return response.ok &&
    html.trim().length > 0 &&
    expectedText.every((item) => item.found)
    ? "pass"
    : "fail";
}

function executedAccessibilityStatus(html: string): StartupUiValidationStatus {
  const hasLandmark = /<main[\s>]|role=["']main["']|<h1[\s>]/i.test(html);
  const hasLabelSignal =
    /<title[\s>]|aria-label=|<label[\s>]|alt=|<button[\s>][^<]+/i.test(html);

  return hasLandmark && hasLabelSignal ? "pass" : "fail";
}

function executedResponsiveStatus(viewport: string): StartupUiValidationStatus {
  return viewport.trim().length > 0 ? "pass" : "fail";
}

export function parseStartupUiValidationStatus(
  value: string
): StartupUiValidationStatus {
  if (value === "pass" || value === "fail" || value === "not_run") {
    return value;
  }

  throw new Error("UI validation status must be one of: pass, fail, not_run");
}

function uiValidationFailed(input: {
  domStatus: StartupUiValidationStatus;
  accessibilityStatus: StartupUiValidationStatus;
  responsiveStatus: StartupUiValidationStatus;
  criticalFlowStatus: StartupUiValidationStatus;
}): boolean {
  return [
    input.domStatus,
    input.accessibilityStatus,
    input.responsiveStatus,
    input.criticalFlowStatus
  ].includes("fail");
}
