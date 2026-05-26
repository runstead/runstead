import { execFile } from "node:child_process";
import { access, readdir, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const DEFAULT_REPO_INSPECTION_GIT_TIMEOUT_MS = 30_000;
export const DEFAULT_REPO_INSPECTION_GIT_MAX_OUTPUT_BYTES = 1024 * 1024;

export interface GitInspection {
  isGitRepo: boolean;
  root?: string;
  branch?: string;
  headSha?: string;
}

export interface InspectGitRepositoryOptions {
  gitTimeoutMs?: number;
  gitMaxOutputBytes?: number;
}

export {
  inspectBuildCommand,
  inspectLintCommand,
  inspectPackageManager,
  inspectTestCommand,
  inspectTypecheckCommand
} from "./repo-inspection-package.js";
export type {
  PackageManager,
  PackageManagerInspection,
  PackageManagerSource,
  PackageScriptCommandInspection
} from "./repo-inspection-package.js";

export type CiProvider =
  | "github_actions"
  | "gitlab_ci"
  | "circleci"
  | "jenkins"
  | "azure_pipelines"
  | "bitbucket_pipelines"
  | "buildkite"
  | "travis_ci";

export interface CiProviderMatch {
  provider: CiProvider;
  configPath: string;
}

export interface CiProviderInspection {
  detected: boolean;
  cwd: string;
  providers: CiProviderMatch[];
}

export async function inspectGitRepository(
  cwd = process.cwd(),
  options: InspectGitRepositoryOptions = {}
): Promise<GitInspection> {
  const workspace = resolve(cwd);
  const gitOptions = {
    maxOutputBytes:
      options.gitMaxOutputBytes ?? DEFAULT_REPO_INSPECTION_GIT_MAX_OUTPUT_BYTES,
    timeoutMs: options.gitTimeoutMs ?? DEFAULT_REPO_INSPECTION_GIT_TIMEOUT_MS
  };
  const root = await runGit(["rev-parse", "--show-toplevel"], workspace, gitOptions);

  if (!root.ok) {
    return {
      isGitRepo: false
    };
  }

  const branch = await runGit(["branch", "--show-current"], workspace, gitOptions);
  const headSha = await runGit(
    ["rev-parse", "--verify", "HEAD"],
    workspace,
    gitOptions
  );
  const inspection: GitInspection = {
    isGitRepo: true,
    root: await realpath(root.stdout)
  };

  if (branch.ok && branch.stdout.length > 0) {
    inspection.branch = branch.stdout;
  }

  if (headSha.ok && headSha.stdout.length > 0) {
    inspection.headSha = headSha.stdout;
  }

  return inspection;
}

export async function inspectCiProvider(
  cwd = process.cwd()
): Promise<CiProviderInspection> {
  const workspace = resolve(cwd);
  const providers: CiProviderMatch[] = [];
  const githubActionsPath = join(workspace, ".github", "workflows");

  if (await hasYamlFile(githubActionsPath)) {
    providers.push({
      provider: "github_actions",
      configPath: githubActionsPath
    });
  }

  for (const config of ciProviderConfigPaths) {
    const configPath = join(workspace, config.relativePath);

    if (await exists(configPath)) {
      providers.push({
        provider: config.provider,
        configPath
      });
    }
  }

  return {
    detected: providers.length > 0,
    cwd: workspace,
    providers
  };
}

interface GitCommandResult {
  ok: boolean;
  stdout: string;
}

async function runGit(
  args: string[],
  cwd: string,
  options: { maxOutputBytes: number; timeoutMs: number }
): Promise<GitCommandResult> {
  try {
    const result = await execFileAsync("git", args, {
      cwd,
      maxBuffer: options.maxOutputBytes,
      timeout: options.timeoutMs,
      windowsHide: true
    });

    return {
      ok: true,
      stdout: result.stdout.trim()
    };
  } catch {
    return {
      ok: false,
      stdout: ""
    };
  }
}

const ciProviderConfigPaths: { provider: CiProvider; relativePath: string }[] = [
  { provider: "gitlab_ci", relativePath: ".gitlab-ci.yml" },
  { provider: "gitlab_ci", relativePath: ".gitlab-ci.yaml" },
  { provider: "circleci", relativePath: ".circleci/config.yml" },
  { provider: "circleci", relativePath: ".circleci/config.yaml" },
  { provider: "jenkins", relativePath: "Jenkinsfile" },
  { provider: "azure_pipelines", relativePath: "azure-pipelines.yml" },
  { provider: "azure_pipelines", relativePath: "azure-pipelines.yaml" },
  { provider: "bitbucket_pipelines", relativePath: "bitbucket-pipelines.yml" },
  { provider: "bitbucket_pipelines", relativePath: "bitbucket-pipelines.yaml" },
  { provider: "buildkite", relativePath: ".buildkite/pipeline.yml" },
  { provider: "buildkite", relativePath: ".buildkite/pipeline.yaml" },
  { provider: "travis_ci", relativePath: ".travis.yml" },
  { provider: "travis_ci", relativePath: ".travis.yaml" }
];

async function hasYamlFile(path: string): Promise<boolean> {
  try {
    const entries = await readdir(path, { withFileTypes: true });

    return entries.some((entry) => entry.isFile() && /\.ya?ml$/i.test(entry.name));
  } catch {
    return false;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
