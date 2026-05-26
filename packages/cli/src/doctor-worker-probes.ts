import {
  errorMessage,
  fail,
  pass,
  truncateDoctorMessage,
  type DoctorCheck
} from "./doctor-types.js";
import {
  claudeCodeAuthHint,
  claudeCodeProbeSucceeded,
  codexCliAuthHint
} from "./doctor-worker-helpers.js";
import { workerCommand, type WorkerProcessRunner } from "./wrapped-worker.js";

export async function checkCodexCliBinary(
  cwd: string,
  runner: WorkerProcessRunner
): Promise<DoctorCheck> {
  try {
    const result = await runner("codex", ["--version"], {
      cwd,
      timeoutMs: 10_000,
      maxOutputBytes: 20_000
    });
    const output = `${result.stdout}${result.stderr}`.trim();

    return result.exitCode === 0
      ? pass("codex-cli-binary", "Codex CLI binary", output || "codex found")
      : fail(
          "codex-cli-binary",
          "Codex CLI binary",
          `codex --version exited ${result.exitCode}: ${output}`
        );
  } catch (error) {
    return fail("codex-cli-binary", "Codex CLI binary", errorMessage(error));
  }
}

export async function checkClaudeCodeBinary(
  cwd: string,
  runner: WorkerProcessRunner
): Promise<DoctorCheck> {
  try {
    const result = await runner("claude", ["--version"], {
      cwd,
      timeoutMs: 10_000,
      maxOutputBytes: 20_000
    });
    const output = `${result.stdout}${result.stderr}`.trim();

    return result.exitCode === 0
      ? pass("claude-code-binary", "Claude Code CLI binary", output || "claude found")
      : fail(
          "claude-code-binary",
          "Claude Code CLI binary",
          `claude --version exited ${result.exitCode}: ${output}`
        );
  } catch (error) {
    return fail("claude-code-binary", "Claude Code CLI binary", errorMessage(error));
  }
}

export async function checkCodexCliExecProbe(options: {
  cwd: string;
  model?: string;
  runner: WorkerProcessRunner;
}): Promise<DoctorCheck> {
  const prompt =
    'Return exactly this JSON and nothing else: {"runstead_codex_cli_probe":true}';
  const command = workerCommand("codex_cli", prompt, {
    workspace: options.cwd,
    ...(options.model === undefined ? {} : { model: options.model })
  });

  try {
    const result = await options.runner(command.command, command.args, {
      cwd: options.cwd,
      timeoutMs: 120_000,
      maxOutputBytes: 120_000
    });
    const stdout = result.stdout.trim();
    const stderr = result.stderr.trim();
    const authHint = codexCliAuthHint(stderr);

    if (result.exitCode !== 0) {
      return fail(
        "codex-cli-exec",
        "Codex CLI exec probe",
        [
          `codex exec exited ${result.exitCode}`,
          ...(stdout.length === 0 ? [] : [`stdout=${truncateDoctorMessage(stdout)}`]),
          ...(stderr.length === 0 ? [] : [`stderr=${truncateDoctorMessage(stderr)}`]),
          authHint
        ]
          .filter((line): line is string => line !== undefined)
          .join("; ")
      );
    }

    if (!stdout.includes('"runstead_codex_cli_probe":true')) {
      return fail(
        "codex-cli-exec",
        "Codex CLI exec probe",
        [
          "codex exec completed but did not return the expected probe JSON",
          ...(stdout.length === 0
            ? ["stdout was empty"]
            : [`stdout=${truncateDoctorMessage(stdout)}`]),
          ...(stderr.length === 0 ? [] : [`stderr=${truncateDoctorMessage(stderr)}`]),
          authHint
        ]
          .filter((line): line is string => line !== undefined)
          .join("; ")
      );
    }

    return pass(
      "codex-cli-exec",
      "Codex CLI exec probe",
      [
        `ok${
          options.model === undefined
            ? " using Codex CLI default model"
            : ` using model=${options.model}`
        }`,
        ...(stderr.length === 0 ? [] : [`stderr=${truncateDoctorMessage(stderr)}`]),
        authHint
      ]
        .filter((line): line is string => line !== undefined)
        .join("; ")
    );
  } catch (error) {
    return fail("codex-cli-exec", "Codex CLI exec probe", errorMessage(error));
  }
}

export async function checkClaudeCodePrintProbe(options: {
  cwd: string;
  model?: string;
  runner: WorkerProcessRunner;
}): Promise<DoctorCheck> {
  const prompt =
    "Return structured output with summary runstead_claude_code_probe, no changed files, no commands, no risks, and no approval needed.";
  const command = workerCommand("claude_code", prompt, {
    ...(options.model === undefined ? {} : { model: options.model })
  });

  try {
    const result = await options.runner(command.command, command.args, {
      cwd: options.cwd,
      timeoutMs: 120_000,
      maxOutputBytes: 120_000
    });
    const stdout = result.stdout.trim();
    const stderr = result.stderr.trim();
    const authHint = claudeCodeAuthHint(`${stdout}\n${stderr}`);

    if (result.exitCode !== 0) {
      return fail(
        "claude-code-print",
        "Claude Code CLI print probe",
        [
          `claude -p exited ${result.exitCode}`,
          ...(stdout.length === 0 ? [] : [`stdout=${truncateDoctorMessage(stdout)}`]),
          ...(stderr.length === 0 ? [] : [`stderr=${truncateDoctorMessage(stderr)}`]),
          authHint
        ]
          .filter((line): line is string => line !== undefined)
          .join("; ")
      );
    }

    if (!claudeCodeProbeSucceeded(stdout)) {
      return fail(
        "claude-code-print",
        "Claude Code CLI print probe",
        [
          "claude -p completed but did not return the expected probe JSON",
          ...(stdout.length === 0
            ? ["stdout was empty"]
            : [`stdout=${truncateDoctorMessage(stdout)}`]),
          ...(stderr.length === 0 ? [] : [`stderr=${truncateDoctorMessage(stderr)}`]),
          authHint
        ]
          .filter((line): line is string => line !== undefined)
          .join("; ")
      );
    }

    return pass(
      "claude-code-print",
      "Claude Code CLI print probe",
      [
        `ok${
          options.model === undefined
            ? " using Claude Code CLI default model"
            : ` using model=${options.model}`
        }`,
        ...(stderr.length === 0 ? [] : [`stderr=${truncateDoctorMessage(stderr)}`]),
        authHint
      ]
        .filter((line): line is string => line !== undefined)
        .join("; ")
    );
  } catch (error) {
    return fail(
      "claude-code-print",
      "Claude Code CLI print probe",
      errorMessage(error)
    );
  }
}
