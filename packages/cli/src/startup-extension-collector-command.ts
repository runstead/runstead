import { spawn } from "node:child_process";

export function runExtensionCollectorCommand(input: {
  cwd: string;
  command: string;
  timeoutMs: number;
}): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return new Promise((resolveCommand) => {
    const child = spawn(input.command, {
      cwd: input.cwd,
      shell: true,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const stdout: string[] = [];
    const stderr: string[] = [];
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
    }, input.timeoutMs);

    child.stdout.on("data", (chunk) => stdout.push(String(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(String(chunk)));
    child.once("close", (exitCode) => {
      clearTimeout(timeout);
      resolveCommand({
        stdout: stdout.join(""),
        stderr: stderr.join(""),
        exitCode
      });
    });
  });
}
