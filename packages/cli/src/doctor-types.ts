import type { RuntimeBackendConfigEnv } from "@runstead/runtime";

import type { CodexAuthStatus } from "./codex-auth.js";
import type { ResolveCodexModelResult } from "./codex-model.js";
import type { WorkerProcessRunner, WrappedWorkerKind } from "./wrapped-worker.js";

export type DoctorCheckStatus = "pass" | "fail";

export interface DoctorCheck {
  id: string;
  label: string;
  status: DoctorCheckStatus;
  message: string;
}

export interface DoctorResult {
  ok: boolean;
  root: string;
  checks: DoctorCheck[];
}

export interface DoctorRunsteadOptions {
  cwd?: string;
  codex?: boolean;
  worker?: "codex_direct" | WrappedWorkerKind;
  model?: string;
  nodeVersion?: string;
  codexAuthStatus?: () => Promise<
    Pick<CodexAuthStatus, "loggedIn" | "accessTokenExpired" | "authPath">
  >;
  codexModelResolver?: (options: { cwd?: string }) => Promise<ResolveCodexModelResult>;
  codexCliProbeRunner?: WorkerProcessRunner;
  wrappedWorkerProbeRunner?: WorkerProcessRunner;
  modelProviderEnv?: NodeJS.ProcessEnv;
  runtimeBackendEnv?: RuntimeBackendConfigEnv;
  runtimeBackendNow?: Date;
}

export function pass(id: string, label: string, message: string): DoctorCheck {
  return {
    id,
    label,
    status: "pass",
    message
  };
}

export function fail(id: string, label: string, message: string): DoctorCheck {
  return {
    id,
    label,
    status: "fail",
    message
  };
}

export function checkNodeRuntime(version: string): DoctorCheck {
  const parsed = parseNodeVersion(version);

  if (parsed === undefined) {
    return pass(
      "node-runtime",
      "Node runtime",
      `could not parse ${version}; Runstead CLI expects Node >=24.15 <27`
    );
  }

  const supported =
    (parsed.major > 24 || (parsed.major === 24 && parsed.minor >= 15)) &&
    parsed.major < 27;

  return pass(
    "node-runtime",
    "Node runtime",
    supported
      ? `${version} satisfies package engines >=24.15 <27`
      : `${version} is outside package engines >=24.15 <27; use Node 24.15+ before release packaging`
  );
}

export function truncateDoctorMessage(value: string, maxLength = 500): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}...`;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseNodeVersion(
  version: string
): { major: number; minor: number; patch: number } | undefined {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version);

  if (match === null) {
    return undefined;
  }

  return {
    major: Number(match[1] ?? "0"),
    minor: Number(match[2] ?? "0"),
    patch: Number(match[3] ?? "0")
  };
}
