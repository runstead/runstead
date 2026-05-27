import type { JsonObject } from "@runstead/core";

import type { ShellCommandResult } from "../shell-executor.js";

export function shellCommandOutput(result: ShellCommandResult): JsonObject {
  return {
    command: result.command,
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    forceKilled: result.forceKilled,
    stdoutBytes: Buffer.byteLength(result.stdout, "utf8"),
    stderrBytes: Buffer.byteLength(result.stderr, "utf8"),
    stdoutTruncated: result.stdoutTruncated,
    stderrTruncated: result.stderrTruncated
  };
}

export function toolExecutionErrorOutput(error: unknown): JsonObject {
  return {
    ok: false,
    error: {
      message: error instanceof Error ? error.message : String(error),
      name: error instanceof Error ? error.name : "Error"
    }
  };
}

export function previewText(value: string): string {
  return value.length <= 500 ? value : `${value.slice(0, 500)}...`;
}
