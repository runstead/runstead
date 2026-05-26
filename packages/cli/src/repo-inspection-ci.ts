import { access, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

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
