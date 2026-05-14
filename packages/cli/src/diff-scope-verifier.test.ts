import { describe, expect, it } from "vitest";

import {
  formatGitDiffScopeReport,
  verifyGitDiffScope,
  type GitDiffRunner
} from "./diff-scope-verifier.js";
import { matchesPolicyPathPattern } from "./policy.js";

describe("matchesPolicyPathPattern", () => {
  it("matches policy-style path globs", () => {
    expect(matchesPolicyPathPattern("infra/prod/app.yaml", "infra/prod/**")).toBe(true);
    expect(matchesPolicyPathPattern("src/index.ts", "src/**/*.ts")).toBe(true);
  });
});

describe("verifyGitDiffScope", () => {
  it("flags denied paths and files outside the allowed scope", async () => {
    const calls: { args: string[]; cwd: string; timeoutMs?: number }[] = [];
    const runner: GitDiffRunner = (args, options) => {
      calls.push({
        args,
        cwd: options.cwd,
        ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs })
      });

      return Promise.resolve({
        stdout: "src/index.ts\n.env\nREADME.md\n",
        stderr: "",
        exitCode: 0
      });
    };

    const result = await verifyGitDiffScope({
      cwd: "/repo",
      baseRef: "main",
      headRef: "feature",
      allowedPaths: ["src/**"],
      deniedPaths: [".env", "infra/prod/**"],
      runner
    });

    expect(result).toEqual({
      cwd: "/repo",
      passed: false,
      changedFiles: ["src/index.ts", ".env", "README.md"],
      violations: [
        {
          path: ".env",
          reason: "denied_path",
          pattern: ".env"
        },
        {
          path: "README.md",
          reason: "outside_allowed_scope"
        }
      ]
    });
    expect(calls).toEqual([
      {
        cwd: "/repo",
        timeoutMs: 60000,
        args: ["diff", "--name-only", "main...feature"]
      }
    ]);
    expect(formatGitDiffScopeReport(result)).toContain("Status: failed");
  });
});
