import { createVerify, generateKeyPairSync } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openRunsteadDatabase } from "@runstead/state-sqlite";
import { describe, expect, it } from "vitest";

import {
  createGitHubAppJwt,
  createGitHubAppJwtFromConfig,
  formatGitHubAppConfigSummary,
  initGitHubAppMode,
  loadGitHubAppConfig
} from "./github-app.js";

describe("github app mode", () => {
  it("configures GitHub App mode and signs a JWT", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-github-app-"));
    const root = join(workspace, ".runstead");
    const keyPath = join(workspace, "github-app.pem");
    const { privateKey, publicKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048
    });
    const privateKeyPem = privateKey.export({
      type: "pkcs8",
      format: "pem"
    }) as string;

    try {
      await mkdir(root, { recursive: true });
      await writeFile(
        join(root, "config.yaml"),
        "version: 1\ndomain: repo-maintenance\n",
        "utf8"
      );
      await writeFile(keyPath, privateKeyPem, "utf8");

      const configured = await initGitHubAppMode({
        cwd: workspace,
        appId: "12345",
        installationId: "67890",
        privateKeyPath: keyPath,
        now: new Date("2026-05-14T08:00:00.000Z")
      });
      const config = await loadGitHubAppConfig({ cwd: workspace });
      const jwt = await createGitHubAppJwtFromConfig({
        cwd: workspace,
        now: new Date("2026-05-14T08:00:00.000Z")
      });
      const directJwt = createGitHubAppJwt({
        appId: "12345",
        privateKeyPem,
        now: new Date("2026-05-14T08:00:00.000Z")
      });
      const eventId = configured.event?.eventId;
      const [header, payload, signature] = jwt.token.split(".");

      if (
        header === undefined ||
        payload === undefined ||
        signature === undefined ||
        eventId === undefined
      ) {
        throw new Error("Expected a three-part JWT and audit event");
      }

      const decodedHeader = JSON.parse(
        Buffer.from(header, "base64url").toString("utf8")
      ) as { alg: string; typ: string };
      const decodedPayload = JSON.parse(
        Buffer.from(payload, "base64url").toString("utf8")
      ) as { iss: string; iat: number; exp: number };
      const verifier = createVerify("RSA-SHA256");

      verifier.update(`${header}.${payload}`);
      verifier.end();

      expect(config).toEqual({
        appId: "12345",
        installationId: "67890",
        privateKeyPath: keyPath,
        apiBaseUrl: "https://api.github.com"
      });
      expect(formatGitHubAppConfigSummary(config)).toContain("GitHub App: 12345");
      expect(decodedHeader).toEqual({
        alg: "RS256",
        typ: "JWT"
      });
      expect(decodedPayload).toEqual({
        iss: "12345",
        iat: 1778745540,
        exp: 1778746140
      });
      expect(verifier.verify(publicKey, Buffer.from(signature, "base64url"))).toBe(
        true
      );
      expect(directJwt.issuedAt).toBe(jwt.issuedAt);
      expect(directJwt.expiresAt).toBe(jwt.expiresAt);

      const database = openRunsteadDatabase(configured.stateDb);

      try {
        const event = database
          .prepare(
            `
            SELECT type, aggregate_type, aggregate_id, payload_json
            FROM events
            WHERE event_id = ?
          `
          )
          .get(eventId) as {
          type: string;
          aggregate_type: string;
          aggregate_id: string;
          payload_json: string;
        };

        expect(event).toMatchObject({
          type: "github_app.configured",
          aggregate_type: "github_app",
          aggregate_id: "12345"
        });
        expect(JSON.parse(event.payload_json)).toMatchObject({
          appId: "12345",
          installationId: "67890"
        });
      } finally {
        database.close();
      }
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});
