import { readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createSkillCandidatePackage } from "./candidate.js";

describe("createSkillCandidatePackage", () => {
  it("creates a complete candidate skill package", async () => {
    const root = join(
      tmpdir(),
      `runstead-skill-candidate-${process.pid}`,
      "fix-pnpm-ci-failures"
    );

    try {
      await rm(join(root, ".."), { force: true, recursive: true });

      const result = await createSkillCandidatePackage({
        root,
        name: "fix-pnpm-ci-failures",
        domain: "repo-maintenance",
        description: "Diagnose and repair pnpm-related CI failures.",
        triggers: ["ci_failure", "log_contains:pnpm"],
        allowedTools: ["filesystem.read", "filesystem.write_workspace"],
        deniedTools: ["secret.read", "network.write_external"],
        verifierCommands: ["pnpm test", "pnpm lint"],
        provenanceTasks: ["task_001"],
        scopeRepos: ["acme/app"]
      });
      const skillYaml = await readFile(join(root, "skill.yaml"), "utf8");
      const runScript = await stat(join(root, "tests", "run.sh"));

      expect(result.validation.valid).toBe(true);
      expect(skillYaml).toContain("name: fix-pnpm-ci-failures");
      expect(skillYaml).toContain("status: candidate");
      expect(await readFile(join(root, "SKILL.md"), "utf8")).toContain(
        "Diagnose and repair pnpm-related CI failures."
      );
      expect(runScript.mode & 0o111).not.toBe(0);
    } finally {
      await rm(join(root, ".."), { force: true, recursive: true });
    }
  });

  it("rejects candidates without provenance tasks", async () => {
    const root = join(
      tmpdir(),
      `runstead-skill-candidate-invalid-${process.pid}`,
      "fix-pnpm-ci-failures"
    );

    try {
      await rm(join(root, ".."), { force: true, recursive: true });

      await expect(
        createSkillCandidatePackage({
          root,
          name: "fix-pnpm-ci-failures",
          domain: "repo-maintenance",
          description: "Diagnose and repair pnpm-related CI failures.",
          triggers: ["ci_failure"],
          allowedTools: ["filesystem.read"],
          deniedTools: ["secret.read"],
          verifierCommands: ["pnpm test"],
          provenanceTasks: []
        })
      ).rejects.toThrow("provenance tasks");
    } finally {
      await rm(join(root, ".."), { force: true, recursive: true });
    }
  });
});
