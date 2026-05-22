import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { requireRunsteadStateDb } from "./runstead-root.js";
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
  sourceRefs?: string[];
  sources?: StartupEvidenceSourceInput[];
  goalId?: string;
  now?: Date;
}

export interface RecordStartupUiValidationResult {
  evidence: AddStartupEvidenceResult;
  failed: boolean;
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
    criticalFlowStatus: options.criticalFlowStatus ?? "not_run"
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
