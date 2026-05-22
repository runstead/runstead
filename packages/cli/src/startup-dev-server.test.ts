import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  detectStartupDevServerCommand,
  startStartupDevServer
} from "./startup-dev-server.js";

describe("startup dev server lifecycle", () => {
  it("detects, starts, health-checks, and stops a local dev server", async () => {
    const workspace = join(tmpdir(), `runstead-startup-dev-server-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      await mkdir(workspace, { recursive: true });
      await writeFile(
        join(workspace, "package.json"),
        `${JSON.stringify(
          {
            name: "runstead-dev-server-fixture",
            private: true,
            scripts: {
              dev: "node server.mjs"
            }
          },
          null,
          2
        )}\n`,
        "utf8"
      );
      await writeFile(
        join(workspace, "server.mjs"),
        [
          "import http from 'node:http';",
          "const server = http.createServer((_request, response) => {",
          "  response.writeHead(200, { 'content-type': 'text/html' });",
          "  response.end('<main><h1>Todo MVP</h1></main>');",
          "});",
          "server.listen(Number(process.env.PORT), '127.0.0.1');",
          "process.on('SIGTERM', () => server.close(() => process.exit(0)));"
        ].join("\n"),
        "utf8"
      );

      await expect(detectStartupDevServerCommand(workspace)).resolves.toBe(
        "npm run dev"
      );

      const server = await startStartupDevServer({
        cwd: workspace,
        timeoutMs: 5_000
      });

      try {
        await expect(
          fetch(server.url).then((response) => response.text())
        ).resolves.toContain("Todo MVP");
        expect(server.command).toBe("npm run dev");
        expect(server.managed).toBe(true);
      } finally {
        await server.stop();
      }

      await expect(fetch(server.url)).rejects.toThrow();
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});
