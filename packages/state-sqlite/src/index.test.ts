import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { openRunsteadDatabase } from "./index.js";

describe("openRunsteadDatabase", () => {
  it("creates the v0 state tables", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-state-"));

    try {
      const database = openRunsteadDatabase(join(workspace, "state.db"));
      const rows = database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as { name: string }[];

      database.close();

      expect(rows.map((row) => row.name)).toEqual(
        expect.arrayContaining(["goals", "tasks", "evidence", "events"])
      );
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});
