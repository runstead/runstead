import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createConnection, createServer } from "node:net";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export interface StartupDevServerOptions {
  cwd?: string;
  command?: string;
  url?: string;
  port?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface StartupDevServerHandle {
  cwd: string;
  command: string;
  url: string;
  port: number;
  managed: true;
  pid?: number;
  logs: () => StartupDevServerLogs;
  stop: () => Promise<void>;
}

export interface StartupDevServerLogs {
  stdout: string;
  stderr: string;
}

interface PackageJson {
  packageManager?: unknown;
  scripts?: unknown;
}

export async function startStartupDevServer(
  options: StartupDevServerOptions = {}
): Promise<StartupDevServerHandle> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const port = options.port ?? (await findAvailablePort());
  const command = options.command ?? (await detectStartupDevServerCommand(cwd));
  const url = options.url ?? `http://127.0.0.1:${port}`;
  const child = spawn(command, {
    cwd,
    shell: true,
    detached: process.platform !== "win32",
    env: {
      ...process.env,
      PORT: String(port)
    },
    stdio: "pipe"
  });
  const logs = collectStartupDevServerLogs(child);

  try {
    await waitForStartupDevServer({
      url,
      timeoutMs: options.timeoutMs ?? 20_000,
      fetchImpl: options.fetchImpl ?? fetch
    });
  } catch (error) {
    await stopStartupDevServerProcess(child, port);
    throw error;
  }

  return {
    cwd,
    command,
    url,
    port,
    managed: true,
    ...(child.pid === undefined ? {} : { pid: child.pid }),
    logs,
    stop: () => stopStartupDevServerProcess(child, port)
  };
}

function collectStartupDevServerLogs(
  child: ChildProcessWithoutNullStreams
): () => StartupDevServerLogs {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const collect = (chunks: string[]) => (chunk: Buffer | string) => {
    chunks.push(String(chunk));
    const joined = chunks.join("");

    if (joined.length > 64_000) {
      chunks.splice(0, chunks.length, joined.slice(-64_000));
    }
  };

  child.stdout.on("data", collect(stdout));
  child.stderr.on("data", collect(stderr));

  return () => ({
    stdout: stdout.join(""),
    stderr: stderr.join("")
  });
}

export async function detectStartupDevServerCommand(cwd: string): Promise<string> {
  const packageJson = await readPackageJson(cwd);
  const scripts = isRecord(packageJson.scripts) ? packageJson.scripts : {};
  const packageManager = packageManagerCommand(packageJson.packageManager);
  const scriptName = ["dev", "start", "preview"].find(
    (name) => typeof scripts[name] === "string"
  );

  if (scriptName === undefined) {
    throw new Error(
      "No dev server command found. Add a dev/start/preview script or pass --server-command."
    );
  }

  return scriptName === "start"
    ? `${packageManager} start`
    : `${packageManager} run ${scriptName}`;
}

export async function waitForStartupDevServer(input: {
  url: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  const deadline = Date.now() + input.timeoutMs;
  const fetchImpl = input.fetchImpl ?? fetch;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      const response = await fetchImpl(input.url, { redirect: "manual" });

      if (response.status >= 200 && response.status < 500) {
        return;
      }
    } catch (error) {
      lastError = error;
    }

    await sleep(250);
  }

  const suffix =
    lastError instanceof Error && lastError.message.trim().length > 0
      ? ` Last error: ${lastError.message}`
      : "";

  throw new Error(`Timed out waiting for dev server at ${input.url}.${suffix}`);
}

async function readPackageJson(cwd: string): Promise<PackageJson> {
  try {
    const parsed = JSON.parse(
      await readFile(join(cwd, "package.json"), "utf8")
    ) as unknown;

    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

async function findAvailablePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();

    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();

      server.close(() => {
        if (typeof address === "object" && address !== null) {
          resolvePort(address.port);
          return;
        }

        reject(new Error("Failed to allocate a local dev server port"));
      });
    });
  });
}

async function stopStartupDevServerProcess(
  child: ChildProcessWithoutNullStreams,
  port: number
): Promise<void> {
  if (child.exitCode === null && child.signalCode === null) {
    await new Promise<void>((resolveStop) => {
      const timeout = setTimeout(() => {
        signalStartupDevServerProcess(child, "SIGKILL");
        resolveStop();
      }, 3_000);

      child.once("exit", () => {
        clearTimeout(timeout);
        resolveStop();
      });
      signalStartupDevServerProcess(child, "SIGTERM");
    });
  }

  try {
    await waitForPortToClose(port, 3_000);
    return;
  } catch (error) {
    signalStartupDevServerProcess(child, "SIGKILL");

    try {
      await waitForPortToClose(port, 1_000);
    } catch {
      throw error;
    }
  }
}

async function waitForPortToClose(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (!(await canConnectToPort(port))) {
      return;
    }

    await sleep(100);
  }

  throw new Error(`Timed out waiting for dev server port ${port} to close`);
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

function signalStartupDevServerProcess(
  child: ChildProcessWithoutNullStreams,
  signal: NodeJS.Signals
): void {
  if (child.pid === undefined) {
    return;
  }

  try {
    if (process.platform === "win32") {
      child.kill(signal);
      return;
    }

    process.kill(-child.pid, signal);
  } catch (error) {
    if (isSystemError(error) && error.code === "ESRCH") {
      return;
    }

    throw error;
  }
}

function packageManagerCommand(value: unknown): string {
  if (typeof value !== "string") {
    return "npm";
  }

  if (value.startsWith("pnpm@")) {
    return "pnpm";
  }

  if (value.startsWith("yarn@")) {
    return "yarn";
  }

  if (value.startsWith("bun@")) {
    return "bun";
  }

  return "npm";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSystemError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
