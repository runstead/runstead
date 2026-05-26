import { sign } from "node:crypto";

export interface CreateGitHubAppJwtOptions {
  appId: string;
  privateKeyPem: string;
  now?: Date;
}

export interface GitHubAppJwtResult {
  token: string;
  issuedAt: string;
  expiresAt: string;
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

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}
