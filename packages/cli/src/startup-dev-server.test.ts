import { createConnection } from "node:net";
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

      await expect(waitForPortToClose(server.port)).resolves.toBeUndefined();
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});

async function waitForPortToClose(port: number): Promise<void> {
  const deadline = Date.now() + 5_000;

  while (Date.now() < deadline) {
    if (!(await canConnectToPort(port))) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`Timed out waiting for port ${port} to close`);
}

function canConnectToPort(port: number): Promise<boolean> {
  return new Promise((resolveConnected) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    let settled = false;

    const settle = (connected: boolean) => {
      if (settled) {
        return;
      }

      settled = true;
      socket.destroy();
      resolveConnected(connected);
    };

    socket.once("connect", () => settle(true));
    socket.once("error", () => settle(false));
    socket.setTimeout(250, () => settle(false));
  });
}
