import type {
  RuntimeStartupUiValidationExecutionEvidence,
  RuntimeStartupUiValidationFailureCategory,
  RuntimeStartupUiValidationStatus
} from "@runstead/runtime";

import type {
  AddStartupEvidenceResult,
  StartupEvidenceSourceInput
} from "./startup-evidence.js";

export type StartupUiValidationStatus = RuntimeStartupUiValidationStatus;
export type StartupUiValidationFailureCategory =
  RuntimeStartupUiValidationFailureCategory;

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
  flowActions?: StartupUiFlowAction[];
  serverCommand?: string;
  serverPort?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  browserRunner?: StartupUiBrowserRunner;
  goalId?: string;
  now?: Date;
}

export interface ExecuteStartupUiValidationResult extends RecordStartupUiValidationResult {
  url: string;
  domArtifact: string;
  execution: StartupUiValidationExecutionEvidence;
}

export type StartupUiValidationExecutionEvidence =
  RuntimeStartupUiValidationExecutionEvidence;

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

export type StartupUiFlowAction =
  | {
      type: "fill";
      selector?: string;
      selectors?: string[];
      value: string;
    }
  | {
      type: "select";
      selector?: string;
      selectors?: string[];
      value: string;
    }
  | {
      type: "click";
      selector?: string;
      selectors?: string[];
    }
  | {
      type: "expectText";
      text: string;
    }
  | {
      type: "expectCount";
      selector: string;
      count: number;
    }
  | {
      type: "reload";
    }
  | {
      type: "expectPersisted";
      text: string;
      selector?: string;
      selectors?: string[];
    }
  | {
      type: "expectNoOverlap";
      selectors: string[];
    };

export interface StartupUiFlowActionResult {
  type: StartupUiFlowAction["type"];
  status: StartupUiValidationStatus;
  summary: string;
  selector?: string;
  expected?: string | number;
  actual?: string | number;
}

export interface StartupUiValidationExecutionArtifacts {
  dom?: string;
  screenshot?: string;
  consoleLog?: string;
  serverLog?: string;
}

export interface StartupUiBrowserRunnerInput {
  url: string;
  viewport: string;
  expectText: string[];
  flowActions: StartupUiFlowAction[];
  timeoutMs: number;
}

export interface StartupUiBrowserRunnerResult {
  responseStatus: number;
  responseOk: boolean;
  html: string;
  screenshot?: Buffer;
  consoleMessages: string[];
  actionResults: StartupUiFlowActionResult[];
}

export type StartupUiBrowserRunner = (
  input: StartupUiBrowserRunnerInput
) => Promise<StartupUiBrowserRunnerResult>;
