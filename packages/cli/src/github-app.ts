import { constants } from "node:fs";
import { access, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { sign } from "node:crypto";

import { createRunsteadId, type RunsteadEvent } from "@runstead/core";
import { appendEventAndProject, openRunsteadDatabase } from "@runstead/state-sqlite";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { z } from "zod";

import {
  requireRunsteadRoot,
  requireRunsteadRootSync,
  requireRunsteadStateDbSync
} from "./runstead-root.js";

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

export interface CreateGitHubAppJwtOptions {
  appId: string;
  privateKeyPem: string;
  now?: Date;
}

export interface CreateGitHubAppJwtFromConfigOptions {
  cwd?: string;
  now?: Date;
}

export interface GitHubAppJwtResult {
  token: string;
  issuedAt: string;
  expiresAt: string;
}

const DEFAULT_GITHUB_API_BASE_URL = "https://api.github.com";

const GitHubAppConfigYamlSchema = z.object({
  app_id: z.union([z.string().min(1), z.number().int().positive()]),
  private_key_path: z.string().min(1),
  installation_id: z.union([z.string().min(1), z.number().int().positive()]).optional(),
  api_base_url: z.string().url().optional()
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

export function createGitHubAppJwt(
  options: CreateGitHubAppJwtOptions
): GitHubAppJwtResult {
  const nowSeconds = Math.floor((options.now ?? new Date()).getTime() / 1000);
  const issuedAtSeconds = nowSeconds - 60;
  const expiresAtSeconds = nowSeconds + 540;
  const header = base64UrlJson({
    alg: "RS256",
    typ: "JWT"
  });
  const payload = base64UrlJson({
    iat: issuedAtSeconds,
    exp: expiresAtSeconds,
    iss: options.appId
  });
  const signingInput = `${header}.${payload}`;
  const signature = sign(
    "RSA-SHA256",
    Buffer.from(signingInput),
    options.privateKeyPem
  ).toString("base64url");

  return {
    token: `${signingInput}.${signature}`,
    issuedAt: new Date(issuedAtSeconds * 1000).toISOString(),
    expiresAt: new Date(expiresAtSeconds * 1000).toISOString()
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

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
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
