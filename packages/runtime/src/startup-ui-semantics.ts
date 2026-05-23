export type RuntimeStartupUiValidationStatus = "pass" | "fail" | "not_run";
export type RuntimeStartupUiValidationFailureCategory =
  | "product_gap"
  | "selector_unstable"
  | "browser_runtime"
  | "network"
  | "unknown";

export interface RuntimeStartupUiValidationTextCheck {
  text: string;
  found: boolean;
}

export interface RuntimeStartupUiFlowActionResult {
  type: string;
  status: RuntimeStartupUiValidationStatus;
  summary: string;
  selector?: string;
  expected?: string | number;
  actual?: string | number;
}

export interface RuntimeStartupUiValidationExecutionEvidence {
  runner: "http_dom_smoke" | "browser_flow_smoke";
  responseStatus: number;
  responseOk: boolean;
  expectedText: RuntimeStartupUiValidationTextCheck[];
  flowActions?: RuntimeStartupUiFlowActionResult[];
  artifacts?: {
    dom?: string;
    screenshot?: string;
    consoleLog?: string;
    serverLog?: string;
  };
  error?: string;
  failureCategory?: RuntimeStartupUiValidationFailureCategory;
  retryCount?: number;
  retryReason?: string;
  server?: {
    managed: boolean;
    command: string;
    url: string;
    port: number;
  };
}

export function classifyRuntimeStartupUiValidationFailure(
  execution: RuntimeStartupUiValidationExecutionEvidence
): RuntimeStartupUiValidationFailureCategory {
  if (execution.failureCategory !== undefined) {
    return execution.failureCategory;
  }

  const failedAction = execution.flowActions?.find(
    (action) => action.status === "fail"
  );
  const text = [
    execution.error ?? "",
    failedAction?.summary ?? "",
    failedAction?.selector ?? ""
  ]
    .join(" ")
    .toLowerCase();

  if (
    text.includes("no matching selector") ||
    text.includes("strict mode violation") ||
    text.includes("selector")
  ) {
    return "selector_unstable";
  }

  if (
    text.includes("chrome") ||
    text.includes("devtools") ||
    text.includes("playwright") ||
    text.includes("browser") ||
    text.includes("executable") ||
    text.includes("profile")
  ) {
    return "browser_runtime";
  }

  if (
    text.includes("econnrefused") ||
    text.includes("connection refused") ||
    text.includes("timed out") ||
    text.includes("page did not load")
  ) {
    return "network";
  }

  if (execution.expectedText.some((item) => !item.found)) {
    return "product_gap";
  }

  if (!execution.responseOk) {
    return execution.responseStatus === 0 ? "network" : "product_gap";
  }

  return failedAction === undefined ? "unknown" : "product_gap";
}

export function runtimeStartupUiValidationRepairHint(
  execution: RuntimeStartupUiValidationExecutionEvidence
): string {
  const category = classifyRuntimeStartupUiValidationFailure(execution);
  const failedAction = execution.flowActions?.find(
    (action) => action.status === "fail"
  );

  if (category === "selector_unstable") {
    if (failedAction?.type === "fill") {
      return 'Add stable data-testid attributes such as data-testid="todo-input" on the add-task input and data-testid="todo-search" on the search input, then reference them from .runstead/startup/ui-smoke.yaml.';
    }

    if (failedAction?.type === "click") {
      return 'Add stable data-testid attributes such as data-testid="add-todo", data-testid="todo-item", or data-testid="filter-active" to the clicked control and update the UI smoke selectors.';
    }

    return "Replace broad selectors with stable data-testid selectors in .runstead/startup/ui-smoke.yaml.";
  }

  if (category === "product_gap") {
    return "Implement the missing user-visible product state or expected text, then rerun UI smoke.";
  }

  if (category === "browser_runtime") {
    return "Check Playwright/Chrome availability or RUNSTEAD_CHROME_PATH; product code should not be treated as failed until the browser runtime is healthy.";
  }

  if (category === "network") {
    return "Check the dev server command, port, and readiness URL before changing product code.";
  }

  return "Inspect the DOM artifact and update the product flow or UI smoke config with a narrower assertion.";
}

export function runtimeStartupUiValidationInfraStatus(
  execution: RuntimeStartupUiValidationExecutionEvidence | undefined
): RuntimeStartupUiValidationStatus {
  if (execution === undefined) {
    return "not_run";
  }

  const category = classifyRuntimeStartupUiValidationFailure(execution);

  if (category === "browser_runtime" || category === "network") {
    return "fail";
  }

  return "pass";
}
