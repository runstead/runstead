import { readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createSkillCandidatePackage } from "./candidate.js";
import { deprecateSkillPackage, promoteSkillPackage } from "./promotion.js";

describe("promoteSkillPackage", () => {
  it("promotes a candidate only after package tests pass", async () => {
    const root = join(
      tmpdir(),
      `runstead-skill-promote-${process.pid}`,
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
        "#!/usr/bin/env sh\nset -eu\necho promoted\n",
        "utf8"
      );

      const result = await promoteSkillPackage({
        root,
        promotedBy: "maintainer",
        now: new Date("2026-05-14T14:00:00.000Z")
      });
      const skillYaml = await readFile(join(root, "skill.yaml"), "utf8");
      const changelog = await readFile(join(root, "changelog.md"), "utf8");

      expect(result.previousStatus).toBe("candidate");
      expect(result.skill.status).toBe("promoted");
      expect(result.test.passed).toBe(true);
      expect(result.validation.valid).toBe(true);
      expect(result.validation.issues.map((issue) => issue.code)).toContain(
        "non_candidate_status"
      );
      expect(skillYaml).toContain("status: promoted");
      expect(changelog).toContain("Promoted by maintainer at 2026-05-14T14:00:00.000Z");
    } finally {
      await rm(join(root, ".."), { force: true, recursive: true });
    }
  });

  it("does not promote when package tests fail", async () => {
    const root = join(
      tmpdir(),
      `runstead-skill-promote-fail-${process.pid}`,
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
        "#!/usr/bin/env sh\nexit 9\n",
        "utf8"
      );

      await expect(promoteSkillPackage({ root })).rejects.toThrow("tests must pass");
      await expect(readFile(join(root, "skill.yaml"), "utf8")).resolves.toContain(
        "status: candidate"
      );
    } finally {
      await rm(join(root, ".."), { force: true, recursive: true });
    }
  });

  it("deprecates a promoted package and records the reason", async () => {
    const root = join(
      tmpdir(),
      `runstead-skill-deprecate-${process.pid}`,
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
        "#!/usr/bin/env sh\nset -eu\n",
        "utf8"
      );
      await promoteSkillPackage({ root });

      const result = await deprecateSkillPackage({
        root,
        deprecatedBy: "maintainer",
        reason: "superseded by a safer workflow",
        now: new Date("2026-05-14T15:00:00.000Z")
      });
      const changelog = await readFile(join(root, "changelog.md"), "utf8");

      expect(result.previousStatus).toBe("promoted");
      expect(result.skill.status).toBe("deprecated");
      expect(result.validation.valid).toBe(true);
      expect(changelog).toContain(
        "Deprecated by maintainer at 2026-05-14T15:00:00.000Z: superseded by a safer workflow."
      );
    } finally {
      await rm(join(root, ".."), { force: true, recursive: true });
    }
  });

  it("does not deprecate candidates before promotion", async () => {
    const root = join(
      tmpdir(),
      `runstead-skill-deprecate-candidate-${process.pid}`,
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

      await expect(deprecateSkillPackage({ root })).rejects.toThrow(
        "Only promoted skills"
      );
    } finally {
      await rm(join(root, ".."), { force: true, recursive: true });
    }
  });
});
