import { access, cp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { initRunstead } from "./init.js";
import { upgradeRunsteadState } from "./upgrade.js";

describe("upgradeRunsteadState", () => {
  it("repairs missing scaffold defaults and validates the result", async () => {
    const workspace = join(tmpdir(), `runstead-upgrade-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      await initRunstead({ cwd: workspace });
      await rm(join(workspace, ".runstead", "reports"), {
        force: true,
        recursive: true
      });
      await rm(join(workspace, ".runstead", "daemon"), {
        force: true,
        recursive: true
      });
      await rm(join(workspace, ".runstead", "rbac.yaml"), { force: true });
      await rm(join(workspace, ".runstead", ".gitignore"), { force: true });
      await rm(
        join(
          workspace,
          ".runstead",
          "domains",
          "repo-maintenance",
          "task-types",
          "ci_repair.yaml"
        ),
        { force: true }
      );

      const result = await upgradeRunsteadState({ cwd: workspace });

      expect(result.root).toBe(join(workspace, ".runstead"));
      expect(result.checks.every((check) => check.status === "pass")).toBe(true);
      await expect(
        access(join(workspace, ".runstead", "reports"))
      ).resolves.toBeUndefined();
      await expect(
        access(join(workspace, ".runstead", "daemon"))
      ).resolves.toBeUndefined();
      await expect(
        access(join(workspace, ".runstead", "rbac.yaml"))
      ).resolves.toBeUndefined();
      await expect(
        access(join(workspace, ".runstead", ".gitignore"))
      ).resolves.toBeUndefined();
      await expect(
        access(
          join(
            workspace,
            ".runstead",
            "domains",
            "repo-maintenance",
            "task-types",
            "ci_repair.yaml"
          )
        )
      ).resolves.toBeUndefined();
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("repairs old repo-maintenance policy allowlists", async () => {
    const workspace = join(tmpdir(), `runstead-upgrade-policy-${process.pid}`);
    const policyPath = join(
      workspace,
      ".runstead",
      "policies",
      "repo-maintenance.yaml"
    );

    try {
      await rm(workspace, { force: true, recursive: true });
      await initRunstead({ cwd: workspace, profile: "trusted-local" });
      const currentPolicy = await readFile(policyPath, "utf8");
      await writeFile(
        policyPath,
        currentPolicy
          .replace(
            [
              "          - filesystem.read",
              "          - filesystem.list",
              "          - filesystem.search",
              "          - filesystem.stat",
              "          - git.status",
              "          - git.diff",
              "          - git.log",
              "          - git.show",
              "          - git.diff.summary",
              "          - repo.metadata.read",
              "          - evidence.read",
              "          - workspace.facts.read",
              "          - github.run.read",
              "          - github.run.log.read"
            ].join("\n"),
            [
              "          - filesystem.read",
              "          - git.status",
              "          - git.diff"
            ].join("\n")
          )
          .replace(
            [
              "      action_type:",
              "        in:",
              "          - shell.exec",
              "          - verifier.run"
            ].join("\n"),
            "      action_type: shell.exec"
          ),
        "utf8"
      );

      await upgradeRunsteadState({ cwd: workspace });
      const repairedPolicy = await readFile(policyPath, "utf8");

      expect(repairedPolicy).toContain("filesystem.list");
      expect(repairedPolicy).toContain("filesystem.search");
      expect(repairedPolicy).toContain("repo.metadata.read");
      expect(repairedPolicy).toContain("workspace.facts.read");
      expect(repairedPolicy).toContain("verifier.run");
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("requires legacy .team state to be migrated first", async () => {
    const workspace = join(tmpdir(), `runstead-upgrade-team-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      await initRunstead({ cwd: workspace });
      await cp(join(workspace, ".runstead"), join(workspace, ".team"), {
        recursive: true
      });
      await rm(join(workspace, ".runstead"), { force: true, recursive: true });

      await expect(upgradeRunsteadState({ cwd: workspace })).rejects.toThrow(
        "Runstead upgrade requires .runstead state"
      );
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("does not rewrite an existing domain manifest to hide local drift", async () => {
    const workspace = join(tmpdir(), `runstead-upgrade-domain-drift-${process.pid}`);
    const domainPath = join(
      workspace,
      ".runstead",
      "domains",
      "repo-maintenance",
      "domain.yaml"
    );

    try {
      await rm(workspace, { force: true, recursive: true });
      await initRunstead({ cwd: workspace });
      await writeFile(
        domainPath,
        `${await readFile(domainPath, "utf8")}\n# drift\n`,
        "utf8"
      );

      await expect(upgradeRunsteadState({ cwd: workspace })).rejects.toThrow(
        "domain-pack-manifests"
      );
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});
