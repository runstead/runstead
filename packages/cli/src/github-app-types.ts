import type { RunsteadEvent } from "@runstead/core";

export interface GitHubAppConfig {
  appId: string;
  privateKeyPath: string;
  installationId?: string;
  apiBaseUrl: string;
}

export interface InitGitHubAppModeOptions {
  cwd?: string;
  appId: string;
  privateKeyPath: string;
  installationId?: string;
  apiBaseUrl?: string;
  force?: boolean;
  now?: Date;
}

export interface InitGitHubAppModeResult {
  path: string;
  config: GitHubAppConfig;
  event?: RunsteadEvent;
  stateDb: string;
  overwritten: boolean;
}

export interface CreateGitHubAppJwtFromConfigOptions {
  cwd?: string;
  now?: Date;
}

export interface CreateGitHubAppInstallationTokenOptions {
  cwd?: string;
  installationId?: string;
  now?: Date;
  fetch?: GitHubAppFetch;
}

export interface GitHubAppInstallationTokenResult {
  installationId: string;
  token: string;
  expiresAt?: string;
  repositorySelection?: string;
  permissions?: Record<string, unknown>;
  event: RunsteadEvent;
  stateDb: string;
}

export type GitHubAppFetch = (
  url: string,
  init: {
    method: "POST";
    headers: Record<string, string>;
  }
) => Promise<GitHubAppFetchResponse>;

export interface GitHubAppFetchResponse {
  ok: boolean;
  status: number;
  statusText: string;
  json(): Promise<unknown>;
  text(): Promise<string>;
}
