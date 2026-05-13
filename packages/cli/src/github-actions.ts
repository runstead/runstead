import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { z } from "zod";

const execFileAsync = promisify(execFile);

export interface GitHubCliCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type GitHubCliRunner = (
  args: string[],
  options: { cwd: string }
) => Promise<GitHubCliCommandResult>;

export interface GetWorkflowRunStatusOptions {
  cwd?: string;
  runId: string;
  runner?: GitHubCliRunner;
}

export interface FetchWorkflowRunLogOptions {
  cwd?: string;
  runId: string;
  runner?: GitHubCliRunner;
}

export interface GitHubWorkflowRunStatus {
  runId: string;
  databaseId?: number;
  workflowName?: string;
  displayTitle?: string;
  status: string;
  conclusion?: string;
  event?: string;
  headBranch?: string;
  headSha?: string;
  url?: string;
}

export interface GitHubWorkflowRunLog {
  runId: string;
  log: string;
  byteLength: number;
}

const WorkflowRunStatusSchema = z.object({
  databaseId: z.union([z.number(), z.string()]).optional().nullable(),
  workflowName: z.string().optional().nullable(),
  displayTitle: z.string().optional().nullable(),
  status: z.string(),
  conclusion: z.string().optional().nullable(),
  event: z.string().optional().nullable(),
  headBranch: z.string().optional().nullable(),
  headSha: z.string().optional().nullable(),
  url: z.string().optional().nullable()
});

export async function getGitHubWorkflowRunStatus(
  options: GetWorkflowRunStatusOptions
): Promise<GitHubWorkflowRunStatus> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const result = await (options.runner ?? runGh)(
    [
      "run",
      "view",
      options.runId,
      "--json",
      [
        "databaseId",
        "workflowName",
        "displayTitle",
        "status",
        "conclusion",
        "event",
        "headBranch",
        "headSha",
        "url"
      ].join(",")
    ],
    { cwd }
  );

  if (result.exitCode !== 0) {
    throw new Error(
      `gh run view failed with exit ${result.exitCode}: ${result.stderr}`
    );
  }

  const parsed = WorkflowRunStatusSchema.parse(JSON.parse(result.stdout));
  const databaseId = normalizeDatabaseId(parsed.databaseId);

  return {
    runId: options.runId,
    ...(databaseId === undefined ? {} : { databaseId }),
    ...(parsed.workflowName == null ? {} : { workflowName: parsed.workflowName }),
    ...(parsed.displayTitle == null ? {} : { displayTitle: parsed.displayTitle }),
    status: parsed.status,
    ...(parsed.conclusion == null ? {} : { conclusion: parsed.conclusion }),
    ...(parsed.event == null ? {} : { event: parsed.event }),
    ...(parsed.headBranch == null ? {} : { headBranch: parsed.headBranch }),
    ...(parsed.headSha == null ? {} : { headSha: parsed.headSha }),
    ...(parsed.url == null ? {} : { url: parsed.url })
  };
}

export function formatWorkflowRunStatus(status: GitHubWorkflowRunStatus): string {
  return [
    "GitHub workflow run",
    `Run: ${status.runId}`,
    ...(status.workflowName === undefined ? [] : [`Workflow: ${status.workflowName}`]),
    ...(status.displayTitle === undefined ? [] : [`Title: ${status.displayTitle}`]),
    `Status: ${status.status}`,
    `Conclusion: ${status.conclusion ?? "none"}`,
    ...(status.headBranch === undefined ? [] : [`Branch: ${status.headBranch}`]),
    ...(status.headSha === undefined ? [] : [`SHA: ${status.headSha}`]),
    ...(status.url === undefined ? [] : [`URL: ${status.url}`])
  ].join("\n");
}

export async function fetchGitHubWorkflowRunLog(
  options: FetchWorkflowRunLogOptions
): Promise<GitHubWorkflowRunLog> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const result = await (options.runner ?? runGh)(
    ["run", "view", options.runId, "--log"],
    { cwd }
  );

  if (result.exitCode !== 0) {
    throw new Error(
      `gh run view --log failed with exit ${result.exitCode}: ${result.stderr}`
    );
  }

  return {
    runId: options.runId,
    log: result.stdout,
    byteLength: Buffer.byteLength(result.stdout)
  };
}

async function runGh(
  args: string[],
  options: { cwd: string }
): Promise<GitHubCliCommandResult> {
  try {
    const result = await execFileAsync("gh", args, {
      cwd: options.cwd,
      maxBuffer: 1024 * 1024 * 10,
      windowsHide: true
    });

    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: 0
    };
  } catch (error) {
    return {
      stdout: commandOutput(error, "stdout"),
      stderr: commandOutput(error, "stderr"),
      exitCode: commandExitCode(error)
    };
  }
}

function normalizeDatabaseId(
  value: number | string | null | undefined
): number | undefined {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value !== "string") {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);

  return Number.isFinite(parsed) ? parsed : undefined;
}

function commandExitCode(error: unknown): number {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "number"
  ) {
    return error.code;
  }

  return 1;
}

function commandOutput(error: unknown, key: "stdout" | "stderr"): string {
  if (typeof error === "object" && error !== null) {
    const output = (error as Record<string, unknown>)[key];

    if (typeof output === "string") {
      return output;
    }
  }

  return "";
}
