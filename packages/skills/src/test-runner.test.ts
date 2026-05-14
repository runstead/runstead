import { rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createSkillCandidatePackage } from "./candidate.js";
import {
  DEFAULT_SKILL_TEST_MAX_OUTPUT_BYTES,
  DEFAULT_SKILL_TEST_TIMEOUT_MS,
  formatSkillTestReport,
  runSkillPackageTests
} from "./test-runner.js";

describe("runSkillPackageTests", () => {
  it("runs the package test script after validation", async () => {
    const root = join(
      tmpdir(),
      `runstead-skill-test-${process.pid}`,
      "fix-pnpm-ci-failures"
    );

    try {
      await rm(join(root, ".."), { force: true, recursive: true });
      await createSkillCandidatePackage({
        root,
        name: "fix-pnpm-ci-failures",
        domain: "repo-maintenance",
        description: "Diagnose and repair pnpm-related CI failures.",
        triggers: ["ci_failure"],
        allowedTools: ["filesystem.read"],
        deniedTools: ["secret.read"],
        verifierCommands: ["pnpm test"],
        provenanceTasks: ["task_001"]
      });
      await writeFile(
        join(root, "tests", "run.sh"),
        "#!/usr/bin/env sh\nset -eu\necho skill-ok\n",
        "utf8"
      );

      const result = await runSkillPackageTests(root);

      expect(result.passed).toBe(true);
      expect(result.timeoutMs).toBe(DEFAULT_SKILL_TEST_TIMEOUT_MS);
      expect(result.maxOutputBytes).toBe(DEFAULT_SKILL_TEST_MAX_OUTPUT_BYTES);
      expect(result.timedOut).toBe(false);
      expect(result.stdout).toContain("skill-ok");
      const report = formatSkillTestReport(result);
      expect(report).toContain(`Timeout: ${DEFAULT_SKILL_TEST_TIMEOUT_MS}ms`);
      expect(report).toContain("Timed out: no");
      expect(report).toContain("Result: passed");
    } finally {
      await rm(join(root, ".."), { force: true, recursive: true });
    }
  });

  it("fails when the package test script exits non-zero", async () => {
    const root = join(
      tmpdir(),
      `runstead-skill-test-fail-${process.pid}`,
      "fix-pnpm-ci-failures"
    );

    try {
      await rm(join(root, ".."), { force: true, recursive: true });
      await createSkillCandidatePackage({
        root,
        name: "fix-pnpm-ci-failures",
        domain: "repo-maintenance",
        description: "Diagnose and repair pnpm-related CI failures.",
        triggers: ["ci_failure"],
        allowedTools: ["filesystem.read"],
        deniedTools: ["secret.read"],
        verifierCommands: ["pnpm test"],
        provenanceTasks: ["task_001"]
      });
      await writeFile(
        join(root, "tests", "run.sh"),
        "#!/usr/bin/env sh\nprintf '%s\\n' skill-failed >&2\nexit 7\n",
        "utf8"
      );

      const result = await runSkillPackageTests(root);

      expect(result.passed).toBe(false);
      expect(result.exitCode).toBe(7);
      expect(result.timedOut).toBe(false);
      expect(result.stderr).toContain("skill-failed");
    } finally {
      await rm(join(root, ".."), { force: true, recursive: true });
    }
  });

  it("fails when the package test script times out", async () => {
    const root = join(
      tmpdir(),
      `runstead-skill-test-timeout-${process.pid}`,
      "fix-pnpm-ci-failures"
    );

    try {
      await rm(join(root, ".."), { force: true, recursive: true });
      await createSkillCandidatePackage({
        root,
        name: "fix-pnpm-ci-failures",
        domain: "repo-maintenance",
        description: "Diagnose and repair pnpm-related CI failures.",
        triggers: ["ci_failure"],
        allowedTools: ["filesystem.read"],
        deniedTools: ["secret.read"],
        verifierCommands: ["pnpm test"],
        provenanceTasks: ["task_001"]
      });
      await writeFile(
        join(root, "tests", "run.sh"),
        "#!/usr/bin/env sh\nset -eu\nsleep 2\n",
        "utf8"
      );

      const result = await runSkillPackageTests(root, { timeoutMs: 25 });

      expect(result.passed).toBe(false);
      expect(result.exitCode).toBe(1);
      expect(result.timeoutMs).toBe(25);
      expect(result.timedOut).toBe(true);
      expect(formatSkillTestReport(result)).toContain("Timed out: yes");
    } finally {
      await rm(join(root, ".."), { force: true, recursive: true });
    }
  });
});
