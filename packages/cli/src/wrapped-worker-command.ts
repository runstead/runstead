import { copyFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import {
  CLAUDE_DISALLOWED_TOOLS,
  type WrappedWorkerKind
} from "./wrapped-worker-governance.js";
import { WRAPPED_WORKER_STRUCTURED_OUTPUT_SCHEMA } from "./wrapped-worker-structured-output.js";

export interface WrappedWorkerCommandEnvOptions {
  worker: WrappedWorkerKind;
  workspace: string;
  workerRuntimeDir?: string;
  env?: Record<string, string>;
}

export async function buildWrappedWorkerEnv(
  options: WrappedWorkerCommandEnvOptions
): Promise<Record<string, string> | undefined> {
  if (options.worker !== "codex_cli") {
    return options.env;
  }

  if (options.env?.CODEX_HOME !== undefined) {
    return options.env;
  }

  const profileDir = join(
    resolve(
      options.workerRuntimeDir ??
        join(options.workspace, ".runstead", "worker-profiles")
    ),
    "codex-cli"
  );
  await mkdir(profileDir, { recursive: true });
  await copyCodexAuth(profileDir, options.env);

  return {
    ...(options.env ?? {}),
    CODEX_HOME: profileDir,
    RUNSTEAD_WRAPPED_WORKER_PROFILE: "isolated-codex-cli"
  };
}

export function workerCommand(
  worker: WrappedWorkerKind,
  prompt: string,
  options: { workspace?: string; model?: string } = {}
): { command: string; args: string[] } {
  switch (worker) {
    case "claude_code": {
      const model = options.model?.trim();

      return {
        command: "claude",
        args: [
          "-p",
          ...(model === undefined || model.length === 0 ? [] : ["--model", model]),
          "--output-format",
          "json",
          "--json-schema",
          JSON.stringify(WRAPPED_WORKER_STRUCTURED_OUTPUT_SCHEMA),
          "--permission-mode",
          "default",
          "--disallowedTools",
          CLAUDE_DISALLOWED_TOOLS.join(","),
          "--",
          prompt
        ]
      };
    }
    case "codex_cli": {
      const model = options.model?.trim();

      return {
        command: "codex",
        args: [
          "exec",
          ...(model === undefined || model.length === 0 ? [] : ["--model", model]),
          "--sandbox",
          "workspace-write",
          ...(options.workspace === undefined
            ? []
            : ["--cd", resolve(options.workspace)]),
          prompt
        ]
      };
    }
  }
}

async function copyCodexAuth(
  profileDir: string,
  env: Record<string, string> | undefined
): Promise<void> {
  const sourceHome = resolve(
    env?.CODEX_HOME ?? process.env.CODEX_HOME ?? join(homedir(), ".codex")
  );

  try {
    await copyFile(join(sourceHome, "auth.json"), join(profileDir, "auth.json"));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;

    if (code !== "ENOENT") {
      throw error;
    }
  }
}
