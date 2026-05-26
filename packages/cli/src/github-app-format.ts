import { stringify as stringifyYaml } from "yaml";

import type { GitHubAppConfig } from "./github-app-types.js";

export function formatGitHubAppConfigSummary(config: GitHubAppConfig): string {
  return [
    `GitHub App: ${config.appId}`,
    `Installation: ${config.installationId ?? "none"}`,
    `API: ${config.apiBaseUrl}`,
    `Private key: ${config.privateKeyPath}`
  ].join("\n");
}

export function formatGitHubAppConfigYaml(config: GitHubAppConfig): string {
  return stringifyYaml({
    app_id: config.appId,
    ...(config.installationId === undefined
      ? {}
      : { installation_id: config.installationId }),
    private_key_path: config.privateKeyPath,
    api_base_url: config.apiBaseUrl
  });
}
