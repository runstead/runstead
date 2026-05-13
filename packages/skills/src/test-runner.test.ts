import { rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createSkillCandidatePackage } from "./candidate.js";
import { formatSkillTestReport, runSkillPackageTests } from "./test-runner.js";

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
      expect(result.stdout).toContain("skill-ok");
      expect(formatSkillTestReport(result)).toContain("Result: passed");
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
      expect(result.stderr).toContain("skill-failed");
    } finally {
      await rm(join(root, ".."), { force: true, recursive: true });
    }
  });
});
