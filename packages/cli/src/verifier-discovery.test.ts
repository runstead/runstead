import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { discoverVerifierCommands } from "./verifier-discovery.js";

describe("verifier discovery", () => {
  it("discovers common pnpm verifier scripts", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-verifier-auto-"));

    try {
      await writeFile(
        join(workspace, "package.json"),
        JSON.stringify(
          {
            packageManager: "pnpm@11.1.1",
            scripts: {
              test: "vitest run",
              lint: "eslint .",
              typecheck: "tsc --noEmit"
            }
          },
          null,
          2
        ),
        "utf8"
      );

      await expect(discoverVerifierCommands({ cwd: workspace })).resolves.toEqual([
        {
          name: "test",
          command: "pnpm test"
        },
        {
          name: "lint",
          command: "pnpm lint"
        },
        {
          name: "typecheck",
          command: "pnpm typecheck"
        }
      ]);
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("uses workspace and turbo hints when scripts are absent", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-verifier-auto-"));

    try {
      await writeFile(
        join(workspace, "package.json"),
        JSON.stringify({ scripts: { test: "turbo test" } }, null, 2),
        "utf8"
      );
      await writeFile(join(workspace, "pnpm-workspace.yaml"), "packages: []\n");
      await writeFile(
        join(workspace, "turbo.json"),
        JSON.stringify({ tasks: { lint: {}, typecheck: {} } }, null, 2),
        "utf8"
      );

      await expect(discoverVerifierCommands({ cwd: workspace })).resolves.toEqual([
        {
          name: "test",
          command: "pnpm test"
        },
        {
          name: "lint",
          command: "pnpm lint"
        },
        {
          name: "typecheck",
          command: "pnpm typecheck"
        }
      ]);
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("falls back to npm commands for plain packages", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-verifier-auto-"));

    try {
      await writeFile(
        join(workspace, "package.json"),
        JSON.stringify({ scripts: { test: "node --test", lint: "eslint ." } }),
        "utf8"
      );

      await expect(discoverVerifierCommands({ cwd: workspace })).resolves.toEqual([
        {
          name: "test",
          command: "npm test"
        },
        {
          name: "lint",
          command: "npm run lint"
        }
      ]);
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});
