import type { JsonObject } from "@runstead/core";

import type {
  GitHubWorkflowRunLog,
  GitHubWorkflowRunStatus
} from "./github-actions.js";

export interface CiFailureClassification extends JsonObject {
  category:
    | "build"
    | "cancelled"
    | "dependency_install"
    | "lint"
    | "test"
    | "timeout"
    | "typecheck"
    | "unknown";
  summary: string;
  confidence: number;
  matchedSignals: string[];
}

export function classifyCiFailure(
  status: GitHubWorkflowRunStatus,
  log: GitHubWorkflowRunLog
): CiFailureClassification {
  const text = `${status.conclusion ?? ""}\n${status.workflowName ?? ""}\n${log.log}`;
  const normalized = text.toLowerCase();

  if (
    status.conclusion === "timed_out" ||
    hasAny(normalized, [
      "workflow run timed out",
      "job timed out",
      "the job running on runner has exceeded",
      "exceeded the maximum execution time"
    ])
  ) {
    return classification("timeout", "Workflow run timed out", 0.9, ["timeout"]);
  }

  if (
    status.conclusion === "cancelled" ||
    hasAny(normalized, ["cancelled", "canceled"])
  ) {
    return classification("cancelled", "Workflow run was cancelled", 0.9, [
      "cancelled"
    ]);
  }

  if (
    hasAny(normalized, [
      "npm err!",
      "pnpm err",
      "yarn error",
      "lockfile",
      "cannot find module",
      "dependency",
      "failed to install",
      "err_pnpm_outdated_lockfile",
      "frozen-lockfile",
      "npm ci can only install",
      "package-lock.json",
      "pnpm-lock.yaml"
    ])
  ) {
    return classification(
      "dependency_install",
      "Dependency installation or resolution failed",
      0.75,
      ["dependency_install"]
    );
  }

  if (hasAny(normalized, ["eslint", "lint failed", "lint error", "ruff", "flake8"])) {
    return classification("lint", "Lint verification failed", 0.75, ["lint"]);
  }

  if (
    /\bts\d{4}\b/i.test(text) ||
    hasAny(normalized, ["typecheck", "type error", "tsc", "mypy", "pyright"])
  ) {
    return classification("typecheck", "Type checking failed", 0.75, ["typecheck"]);
  }

  if (
    hasAny(normalized, [
      "test failed",
      "failing test",
      "failed test",
      "failed tests",
      "tests failed",
      "expected",
      "received",
      "assertionerror",
      "assertion failed",
      "pytest",
      "vitest",
      "jest",
      "@playwright/test",
      "playwright test",
      "cargo test",
      "go test",
      "fail "
    ])
  ) {
    return classification("test", "Test verification failed", 0.7, ["test"]);
  }

  if (
    hasAny(normalized, [
      "build failed",
      "compilation failed",
      "vite build",
      "webpack",
      "could not compile",
      "cargo build",
      "go build",
      "gradle build",
      "mvn package"
    ])
  ) {
    return classification("build", "Build failed", 0.65, ["build"]);
  }

  return classification("unknown", "Workflow failed; cause not classified", 0.2, [
    "unknown"
  ]);
}

function classification(
  category: CiFailureClassification["category"],
  summary: string,
  confidence: number,
  matchedSignals: string[]
): CiFailureClassification {
  return {
    category,
    summary,
    confidence,
    matchedSignals
  };
}

function hasAny(value: string, needles: string[]): boolean {
  return needles.some((needle) => value.includes(needle));
}
