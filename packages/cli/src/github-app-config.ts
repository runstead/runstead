import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { parse as parseYaml } from "yaml";
import { z } from "zod";

import { requireRunsteadRootSync } from "./runstead-root.js";
import type { GitHubAppConfig } from "./github-app-types.js";

export const DEFAULT_GITHUB_API_BASE_URL = "https://api.github.com";

const GitHubAppConfigYamlSchema = z.object({
  app_id: z.union([z.string().min(1), z.number().int().positive()]),
  private_key_path: z.string().min(1),
  installation_id: z.union([z.string().min(1), z.number().int().positive()]).optional(),
  api_base_url: z.string().url().optional()
});

export async function loadGitHubAppConfig(
  options: { cwd?: string } = {}
): Promise<GitHubAppConfig> {
  const path = resolveGitHubAppConfigPath(options.cwd);
  const raw = await readFile(path, "utf8");
  const parsed = GitHubAppConfigYamlSchema.parse(parseYaml(raw));

  return {
    appId: String(parsed.app_id),
    privateKeyPath: parsed.private_key_path,
    ...(parsed.installation_id === undefined
      ? {}
      : { installationId: String(parsed.installation_id) }),
    apiBaseUrl: parsed.api_base_url ?? DEFAULT_GITHUB_API_BASE_URL
  };
}

export function resolveGitHubAppConfigPath(cwd = process.cwd()): string {
  const root = requireRunsteadRootSync(cwd);

  return join(root.root, "github-app.yaml");
}
