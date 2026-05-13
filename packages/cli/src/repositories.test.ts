import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  listRepositories,
  registerRepository,
  showRepository
} from "./repositories.js";
import { initRunstead } from "./init.js";

describe("registerRepository", () => {
  it("registers, lists, shows, and updates repositories by path", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-repos-"));
    const repositoryPath = join(workspace, "widgets");

    try {
      await mkdir(repositoryPath);
      await initRunstead({ cwd: workspace });

      const registered = await registerRepository({
        cwd: workspace,
        path: "widgets",
        alias: "acme/widgets",
        remoteUrl: "git@github.com:acme/widgets.git",
        tags: ["frontend", "frontend", "ci"],
        now: new Date("2026-05-14T05:30:00.000Z")
      });

      expect(registered.created).toBe(true);
      expect(registered.repository.alias).toBe("acme/widgets");
      expect(registered.repository.localPath.endsWith("/widgets")).toBe(true);
      expect(registered.repository.remoteUrl).toBe("git@github.com:acme/widgets.git");
      expect(registered.repository.tags).toEqual(["ci", "frontend"]);

      const shown = showRepository({
        cwd: workspace,
        ref: "acme/widgets"
      });
      const listed = listRepositories({ cwd: workspace });

      expect(shown.repository.id).toBe(registered.repository.id);
      expect(listed.repositories.map((item) => item.alias)).toEqual(["acme/widgets"]);

      const updated = await registerRepository({
        cwd: workspace,
        path: repositoryPath,
        alias: "widgets",
        tags: ["backend"],
        now: new Date("2026-05-14T05:31:00.000Z")
      });

      expect(updated.created).toBe(false);
      expect(updated.repository.id).toBe(registered.repository.id);
      expect(updated.repository.alias).toBe("widgets");
      expect(updated.repository.tags).toEqual(["backend"]);
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  }, 10000);
});
