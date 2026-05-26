import { constants } from "node:fs";
import { access, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

import { createRunsteadId, type RunsteadEvent } from "@runstead/core";
import { appendEventAndProject, openRunsteadDatabase } from "@runstead/state-sqlite";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { z } from "zod";

import {
  requireRunsteadRoot,
  requireRunsteadRootSync,
  requireRunsteadStateDbSync
} from "./runstead-root.js";
import { createGitHubAppJwt } from "./github-app-jwt.js";
import type { GitHubAppJwtResult } from "./github-app-jwt.js";

export { createGitHubAppJwt } from "./github-app-jwt.js";
export type {
  CreateGitHubAppJwtOptions,
  GitHubAppJwtResult
} from "./github-app-jwt.js";

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

const DEFAULT_GITHUB_API_BASE_URL = "https://api.github.com";

const GitHubAppConfigYamlSchema = z.object({
  app_id: z.union([z.string().min(1), z.number().int().positive()]),
  private_key_path: z.string().min(1),
  installation_id: z.union([z.string().min(1), z.number().int().positive()]).optional(),
  api_base_url: z.string().url().optional()
});

const GitHubAppInstallationTokenResponseSchema = z.object({
  token: z.string().min(1),
  expires_at: z.string().min(1).optional(),
  repository_selection: z.string().min(1).optional(),
  permissions: z.record(z.string(), z.unknown()).optional()
});

export async function initGitHubAppMode(
  options: InitGitHubAppModeOptions
): Promise<InitGitHubAppModeResult> {
  const root = await resolveInitializedRoot(options.cwd);
  const path = join(root, "github-app.yaml");
  const stateDb = requireRunsteadStateDbSync(options.cwd ?? process.cwd()).stateDb;
  const existing = await exists(path);

  if (existing && options.force !== true) {
    return {
      path,
      config: await loadGitHubAppConfig(
        options.cwd === undefined ? {} : { cwd: options.cwd }
      ),
      stateDb,
      overwritten: false
    };
  }

  const config: GitHubAppConfig = {
    appId: options.appId,
    privateKeyPath: resolve(options.cwd ?? process.cwd(), options.privateKeyPath),
    ...(options.installationId === undefined
      ? {}
      : { installationId: options.installationId }),
    apiBaseUrl: options.apiBaseUrl ?? DEFAULT_GITHUB_API_BASE_URL
  };

  await assertReadablePrivateKey(config.privateKeyPath);

  const event: RunsteadEvent = {
    eventId: createRunsteadId("evt"),
    type: "github_app.configured",
    aggregateType: "github_app",
    aggregateId: config.appId,
    payload: {
      appId: config.appId,
      privateKeyPath: config.privateKeyPath,
      ...(config.installationId === undefined
        ? {}
        : { installationId: config.installationId }),
      apiBaseUrl: config.apiBaseUrl
    },
    createdAt: (options.now ?? new Date()).toISOString()
  };

  await writeFile(path, formatGitHubAppConfigYaml(config), "utf8");

  const database = openRunsteadDatabase(stateDb);

  try {
    appendEventAndProject(database, { event });
  } finally {
    database.close();
  }

  return {
    path,
    config,
    event,
    stateDb,
    overwritten: existing
  };
}

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

export async function createGitHubAppJwtFromConfig(
  options: CreateGitHubAppJwtFromConfigOptions = {}
): Promise<GitHubAppJwtResult> {
  const root = requireRunsteadRootSync(options.cwd).root;
  const config = await loadGitHubAppConfig(
    options.cwd === undefined ? {} : { cwd: options.cwd }
  );
  const privateKeyPath = isAbsolute(config.privateKeyPath)
    ? config.privateKeyPath
    : join(root, config.privateKeyPath);
  const privateKeyPem = await readFile(privateKeyPath, "utf8");

  return createGitHubAppJwt({
    appId: config.appId,
    privateKeyPem,
    ...(options.now === undefined ? {} : { now: options.now })
  });
}

export async function createGitHubAppInstallationTokenFromConfig(
  options: CreateGitHubAppInstallationTokenOptions = {}
): Promise<GitHubAppInstallationTokenResult> {
  const config = await loadGitHubAppConfig(
    options.cwd === undefined ? {} : { cwd: options.cwd }
  );
  const installationId = options.installationId ?? config.installationId;

  if (installationId === undefined) {
    throw new Error("GitHub App installation id is required");
  }

  const jwt = await createGitHubAppJwtFromConfig({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    ...(options.now === undefined ? {} : { now: options.now })
  });
  const fetcher = options.fetch ?? defaultGitHubAppFetch;
  const response = await fetcher(
    `${trimTrailingSlashes(config.apiBaseUrl)}/app/installations/${encodeURIComponent(
      installationId
    )}/access_tokens`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${jwt.token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "runstead"
      }
    }
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `GitHub App installation token request failed: ${response.status} ${response.statusText}${
        body.length === 0 ? "" : `: ${body}`
      }`
    );
  }

  const parsed = GitHubAppInstallationTokenResponseSchema.parse(await response.json());
  const stateDb = requireRunsteadStateDbSync(options.cwd ?? process.cwd()).stateDb;
  const createdAt = (options.now ?? new Date()).toISOString();
  const event: RunsteadEvent = {
    eventId: createRunsteadId("evt"),
    type: "github_app.installation_token_created",
    aggregateType: "github_app_installation",
    aggregateId: installationId,
    payload: {
      appId: config.appId,
      installationId,
      ...(parsed.expires_at === undefined ? {} : { expiresAt: parsed.expires_at }),
      ...(parsed.repository_selection === undefined
        ? {}
        : { repositorySelection: parsed.repository_selection })
    },
    createdAt
  };
  const database = openRunsteadDatabase(stateDb);

  try {
    appendEventAndProject(database, { event });
  } finally {
    database.close();
  }

  return {
    installationId,
    token: parsed.token,
    ...(parsed.expires_at === undefined ? {} : { expiresAt: parsed.expires_at }),
    ...(parsed.repository_selection === undefined
      ? {}
      : { repositorySelection: parsed.repository_selection }),
    ...(parsed.permissions === undefined ? {} : { permissions: parsed.permissions }),
    event,
    stateDb
  };
}

export function formatGitHubAppConfigSummary(config: GitHubAppConfig): string {
  return [
    `GitHub App: ${config.appId}`,
    `Installation: ${config.installationId ?? "none"}`,
    `API: ${config.apiBaseUrl}`,
    `Private key: ${config.privateKeyPath}`
  ].join("\n");
}

function formatGitHubAppConfigYaml(config: GitHubAppConfig): string {
  return stringifyYaml({
    app_id: config.appId,
    ...(config.installationId === undefined
      ? {}
      : { installation_id: config.installationId }),
    private_key_path: config.privateKeyPath,
    api_base_url: config.apiBaseUrl
  });
}

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/u, "");
}

async function defaultGitHubAppFetch(
  url: string,
  init: Parameters<GitHubAppFetch>[1]
): Promise<GitHubAppFetchResponse> {
  const fetcher = globalThis.fetch as GitHubAppFetch | undefined;

  if (fetcher === undefined) {
    throw new Error("global fetch is not available for GitHub App requests");
  }

  return await fetcher(url, init);
}

function resolveGitHubAppConfigPath(cwd = process.cwd()): string {
  const root = requireRunsteadRootSync(cwd);

  return join(root.root, "github-app.yaml");
}

async function resolveInitializedRoot(cwd = process.cwd()): Promise<string> {
  const root = await requireRunsteadRoot(resolve(cwd));

  return root.root;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function assertReadablePrivateKey(path: string): Promise<void> {
  try {
    await access(path, constants.R_OK);
  } catch {
    throw new Error(`GitHub App private key is not readable: ${path}`);
  }
}
