import { runtimeStartupUiValidationInfraStatus } from "@runstead/runtime";

import { addStartupEvidence } from "./startup-evidence.js";
import { persistStartupUiScreenshot } from "./startup-ui-validation-assets.js";
import { uiValidationFailed } from "./startup-ui-validation-status.js";
import type {
  RecordStartupUiValidationOptions,
  RecordStartupUiValidationResult
} from "./startup-ui-validation-types.js";

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
    infraStatus: runtimeStartupUiValidationInfraStatus(options.execution),
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
