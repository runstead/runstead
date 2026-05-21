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
  const content = {
    url: options.url,
    viewport: options.viewport,
    ...(options.screenshot === undefined ? {} : { screenshot: options.screenshot }),
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
    ...(options.screenshot === undefined ? [] : [options.screenshot])
  ];
  const sources =
    options.sources ??
    (options.screenshot === undefined
      ? undefined
      : [
          {
            kind: "browser_ui",
            uri: options.screenshot
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
