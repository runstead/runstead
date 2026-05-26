import type { StartupDevServerHandle } from "./startup-dev-server.js";
import type {
  StartupUiValidationExecutionEvidence,
  StartupUiValidationServerEvidence,
  StartupUiValidationStatus,
  StartupUiValidationTextCheck
} from "./startup-ui-validation.js";

export function summarizeStartupUiValidationFailure(
  execution: StartupUiValidationExecutionEvidence
): string {
  const failedAction = execution.flowActions?.find(
    (action) => action.status === "fail"
  );

  if (failedAction !== undefined) {
    return startupUiFlowActionFailureSummary(failedAction);
  }

  const missingText = execution.expectedText.find((item) => !item.found);

  if (missingText !== undefined) {
    return `expected text was not visible: ${JSON.stringify(missingText.text)}`;
  }

  if (!execution.responseOk) {
    return execution.responseStatus === 0
      ? "page did not load"
      : `page returned HTTP ${execution.responseStatus}`;
  }

  return execution.error ?? "one or more UI validation checks failed";
}

export function textChecks(
  html: string,
  expectText: string[]
): StartupUiValidationTextCheck[] {
  return expectText.map((text) => ({
    text,
    found: html.includes(text)
  }));
}

export function startupUiFlowActionFailureSummary(
  action: NonNullable<StartupUiValidationExecutionEvidence["flowActions"]>[number]
): string {
  const selector =
    action.selector === undefined || action.selector.length === 0
      ? ""
      : ` selector ${JSON.stringify(action.selector)}`;
  const expected =
    action.expected === undefined ? "" : ` expected ${JSON.stringify(action.expected)}`;
  const actual =
    action.actual === undefined ? "" : ` actual ${JSON.stringify(action.actual)}`;

  return `user action ${action.type}${selector}${expected}${actual} failed: ${action.summary}`;
}

export function serverEvidence(
  server: StartupDevServerHandle | undefined
): { server: StartupUiValidationServerEvidence } | object {
  return server === undefined
    ? {}
    : {
        server: {
          managed: server.managed,
          command: server.command,
          url: server.url,
          port: server.port
        }
      };
}

export function executedDomStatus(
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

export function executedAccessibilityStatus(html: string): StartupUiValidationStatus {
  const hasLandmark = /<main[\s>]|role=["']main["']|<h1[\s>]/i.test(html);
  const hasLabelSignal =
    /<title[\s>]|aria-label=|<label[\s>]|alt=|<button[\s>][^<]+/i.test(html);

  return hasLandmark && hasLabelSignal ? "pass" : "fail";
}

export function executedResponsiveStatus(viewport: string): StartupUiValidationStatus {
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

export function uiValidationFailed(input: {
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

export function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
