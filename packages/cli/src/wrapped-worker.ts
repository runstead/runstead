import { resolve } from "node:path";

import {
  createWorkspaceCheckpoint,
  type GitCheckpointRunner,
  type WorkspaceCheckpoint
} from "./checkpoints.js";
import {
  buildWrappedWorkerGovernanceManifest,
  buildWrappedWorkerPrompt,
  type WrappedWorkerGovernanceManifest,
  type WrappedWorkerKind,
  type WrappedWorkerPromptInput
} from "./wrapped-worker-governance.js";
import { buildWrappedWorkerEnv, workerCommand } from "./wrapped-worker-command.js";
import {
  validateWrappedWorkerStructuredOutput,
  type WrappedWorkerOutputValidation,
  type WrappedWorkerStructuredOutput
} from "./wrapped-worker-structured-output.js";
import {
  appendWorkerProcessNotice,
  DEFAULT_WORKER_MAX_OUTPUT_BYTES,
  DEFAULT_WORKER_TIMEOUT_MS,
  runWorkerProcess,
  type WorkerProcessProgress,
  type WorkerProcessResult,
  type WorkerProcessRunner
} from "./wrapped-worker-process.js";

export interface WrappedWorkerRunOptions extends WrappedWorkerPromptInput {
  runner?: WorkerProcessRunner;
  checkpointDir?: string;
  workerRuntimeDir?: string;
  checkpointBefore?: WorkspaceCheckpoint;
  checkpointRunner?: GitCheckpointRunner;
  model?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  maxOutputBytes?: number;
  progressIntervalMs?: number;
  stuckSilenceMs?: number;
  onProgress?: (progress: WorkerProcessProgress) => void;
}

export interface WrappedWorkerRunResult extends WorkerProcessResult {
  worker: WrappedWorkerKind;
  prompt: string;
  command: string;
  args: string[];
  governance: WrappedWorkerGovernanceManifest;
  outputValidation: WrappedWorkerOutputValidation;
  progress: WrappedWorkerProgressSummary;
  structuredOutput?: WrappedWorkerStructuredOutput;
  checkpointBefore?: WorkspaceCheckpoint;
}

export interface WrappedWorkerProgressSummary {
  heartbeatCount: number;
  possiblyStuck: boolean;
  lastHeartbeatElapsedMs?: number;
  lastOutputElapsedMs?: number;
  stdoutBytes?: number;
  stderrBytes?: number;
  capturedBytes?: number;
}

export type {
  WrappedWorkerOutputValidation,
  WrappedWorkerStructuredOutput
} from "./wrapped-worker-structured-output.js";
export { workerCommand } from "./wrapped-worker-command.js";
export {
  DEFAULT_WORKER_MAX_OUTPUT_BYTES,
  DEFAULT_WORKER_STUCK_SILENCE_MS,
  DEFAULT_WORKER_TIMEOUT_MS,
  formatWorkerProcessProgress,
  runWorkerProcess
} from "./wrapped-worker-process.js";
export type {
  WorkerProcessProgress,
  WorkerProcessResult,
  WorkerProcessRunner
} from "./wrapped-worker-process.js";
export {
  buildWrappedWorkerGovernanceManifest,
  buildWrappedWorkerInternalToolProxyStatus,
  buildWrappedWorkerLaunchGuardrails,
  buildWrappedWorkerPrompt,
  WrappedWorkerHardProxyUnavailableError
} from "./wrapped-worker-governance.js";
export type {
  WrappedWorkerEnforcementCapabilities,
  WrappedWorkerGovernanceManifest,
  WrappedWorkerInternalToolProxyMode,
  WrappedWorkerInternalToolProxyStatus,
  WrappedWorkerKind,
  WrappedWorkerLaunchGuardrails,
  WrappedWorkerPromptInput
} from "./wrapped-worker-governance.js";

export async function startWrappedWorker(
  options: WrappedWorkerRunOptions
): Promise<WrappedWorkerRunResult> {
  const prompt = buildWrappedWorkerPrompt(options);
  const governance = buildWrappedWorkerGovernanceManifest(options);
  const command = workerCommand(options.worker, prompt, {
    workspace: options.workspace,
    ...(options.model === undefined ? {} : { model: options.model })
  });
  const workerEnv = await buildWrappedWorkerEnv(options);
  const checkpointBefore =
    options.checkpointBefore ??
    (options.checkpointDir === undefined
      ? undefined
      : await createWorkspaceCheckpoint({
          workspace: options.workspace,
          checkpointDir: options.checkpointDir,
          ...(options.checkpointRunner === undefined
            ? {}
            : { runner: options.checkpointRunner })
        }));
  let heartbeatCount = 0;
  let latestProgress: WorkerProcessProgress | undefined;
  const onProgress = (progress: WorkerProcessProgress): void => {
    heartbeatCount += 1;
    latestProgress = progress;
    options.onProgress?.(progress);
  };
  const result = await (options.runner ?? runWorkerProcess)(
    command.command,
    command.args,
    {
      cwd: resolve(options.workspace),
      ...(workerEnv === undefined ? {} : { env: workerEnv }),
      timeoutMs: options.timeoutMs ?? DEFAULT_WORKER_TIMEOUT_MS,
      maxOutputBytes: options.maxOutputBytes ?? DEFAULT_WORKER_MAX_OUTPUT_BYTES,
      ...(options.progressIntervalMs === undefined
        ? {}
        : { progressIntervalMs: options.progressIntervalMs }),
      ...(options.stuckSilenceMs === undefined
        ? {}
        : { stuckSilenceMs: options.stuckSilenceMs }),
      onProgress
    }
  );
  const validation = validateWrappedWorkerStructuredOutput(result.stdout);
  const outputValidation: WrappedWorkerOutputValidation =
    validation.reason === undefined
      ? { valid: validation.valid }
      : { valid: validation.valid, reason: validation.reason };
  const finalResult =
    result.exitCode === 0 && !validation.valid
      ? {
          ...result,
          stderr: appendWorkerProcessNotice(
            result.stderr,
            validation.reason ?? "worker did not return valid structured output"
          ),
          exitCode: 1
        }
      : result;

  return {
    worker: options.worker,
    prompt,
    command: command.command,
    args: command.args,
    governance,
    outputValidation,
    progress: wrappedWorkerProgressSummary(heartbeatCount, latestProgress),
    ...(validation.output === undefined ? {} : { structuredOutput: validation.output }),
    ...(checkpointBefore === undefined ? {} : { checkpointBefore }),
    stdout: finalResult.stdout,
    stderr: finalResult.stderr,
    exitCode: finalResult.exitCode
  };
}

function wrappedWorkerProgressSummary(
  heartbeatCount: number,
  latestProgress: WorkerProcessProgress | undefined
): WrappedWorkerProgressSummary {
  return {
    heartbeatCount,
    possiblyStuck: latestProgress?.possiblyStuck ?? false,
    ...(latestProgress === undefined
      ? {}
      : {
          lastHeartbeatElapsedMs: latestProgress.elapsedMs,
          lastOutputElapsedMs: latestProgress.lastOutputElapsedMs,
          stdoutBytes: latestProgress.stdoutBytes,
          stderrBytes: latestProgress.stderrBytes,
          capturedBytes: latestProgress.capturedBytes
        })
  };
}
