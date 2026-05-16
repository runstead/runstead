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
