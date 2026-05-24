import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { startupOnboard } from "./startup-founder-flow.js";
import {
  listStartupSourceConnectorDefinitions,
  recordStartupSourceEvidence,
  STARTUP_SOURCE_CONNECTORS,
  verifyStartupSourceEvidence
} from "./startup-source-connectors.js";

describe("startup source connectors", () => {
  it("records external source evidence with freshness, hash, and trust metadata", async () => {
    const workspace = join(tmpdir(), `runstead-startup-source-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      await mkdir(workspace, { recursive: true });
      await writeFile(
        join(workspace, "package.json"),
        `${JSON.stringify({ name: "source-fixture", private: true }, null, 2)}\n`,
        "utf8"
      );
      await startupOnboard({
        cwd: workspace,
        now: new Date("2026-05-14T00:00:00.000Z")
      });

      const result = await recordStartupSourceEvidence({
        cwd: workspace,
        connector: "github_actions",
        uri: "https://github.com/acme/app/actions/runs/123",
        summary: "Latest launch verifier workflow passed",
        status: "passed",
        capturedAt: "2026-05-14T00:10:00.000Z",
        freshnessDays: 3,
        sourceHash: "sha256:abc123",
        trustLevel: "authoritative",
        payload: JSON.stringify({
          runId: 123,
          conclusion: "success"
        }),
        now: new Date("2026-05-14T00:15:00.000Z")
      });
      const artifact = JSON.parse(await readFile(result.artifactPath, "utf8")) as {
        evidenceType: string;
        sources: {
          kind: string;
          uri: string;
          capturedAt: string;
          freshnessDays: number;
          hash: string;
          trustLevel: string;
          provenance: {
            connector: string;
            captureMode: string;
          };
        }[];
        content: string;
      };
      const content = JSON.parse(artifact.content) as {
        connector: string;
        status: string;
        payload: {
          runId: number;
          conclusion: string;
        };
        qualityTier: string;
        payloadWarnings: string[];
      };

      expect(STARTUP_SOURCE_CONNECTORS).toContain("github_actions");
      expect(result.evidence.type).toBe("startup_repo_readiness");
      expect(result.connector).toBe("github_actions");
      expect(result.definition).toMatchObject({
        displayName: "GitHub Actions",
        qualityTier: "external_observed",
        defaultTrustLevel: "authoritative"
      });
      expect(result.qualityTier).toBe("external_observed");
      expect(result.payloadWarnings).toContain(
        "payload missing recommended field: workflow"
      );
      expect(artifact.evidenceType).toBe("repo_readiness");
      expect(artifact.sources[0]).toMatchObject({
        kind: "github_actions",
        uri: "https://github.com/acme/app/actions/runs/123",
        capturedAt: "2026-05-14T00:10:00.000Z",
        freshnessDays: 3,
        hash: "sha256:abc123",
        trustLevel: "authoritative",
        provenance: {
          connector: "github_actions",
          captureMode: "connector_ingest",
          qualityTier: "external_observed",
          readinessUse: "CI and remote verifier evidence"
        }
      });
      expect(content).toMatchObject({
        connector: "github_actions",
        status: "passed",
        qualityTier: "external_observed",
        trustLevel: "authoritative",
        readinessUse: "CI and remote verifier evidence",
        payload: {
          runId: 123,
          conclusion: "success"
        }
      });
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("lists connector definitions with defensive copies", () => {
    const definitions = listStartupSourceConnectorDefinitions();
    const github = definitions.find(
      (definition) => definition.connector === "github_actions"
    );

    expect(definitions.map((definition) => definition.connector)).toEqual(
      STARTUP_SOURCE_CONNECTORS
    );
    expect(github).toMatchObject({
      evidenceType: "repo_readiness",
      sourceKind: "github_actions",
      qualityTier: "external_observed"
    });
    expect(definitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          connector: "vercel",
          evidenceType: "release_plan",
          sourceKind: "vercel_deployment"
        }),
        expect.objectContaining({
          connector: "fly",
          evidenceType: "release_plan",
          sourceKind: "fly_deployment"
        }),
        expect.objectContaining({
          connector: "render",
          evidenceType: "release_plan",
          sourceKind: "render_deployment"
        }),
        expect.objectContaining({
          connector: "sentry",
          evidenceType: "monitoring_alerts"
        }),
        expect.objectContaining({
          connector: "posthog",
          evidenceType: "metric_snapshot",
          sourceKind: "posthog_analytics"
        })
      ])
    );

    github?.recommendedPayloadFields.push("mutated");

    expect(
      listStartupSourceConnectorDefinitions().find(
        (definition) => definition.connector === "github_actions"
      )?.recommendedPayloadFields
    ).not.toContain("mutated");
  });

  it("records target-specific deployment tiers for named hosting connectors", async () => {
    const workspace = join(tmpdir(), `runstead-startup-source-target-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      await mkdir(workspace, { recursive: true });
      await writeFile(
        join(workspace, "package.json"),
        `${JSON.stringify({ name: "source-target-fixture", private: true }, null, 2)}\n`,
        "utf8"
      );
      await startupOnboard({
        cwd: workspace,
        now: new Date("2026-05-14T00:00:00.000Z")
      });

      const result = await recordStartupSourceEvidence({
        cwd: workspace,
        connector: "vercel",
        uri: "https://vercel.com/acme/todo/deployments/dpl_123",
        summary: "Vercel deployment health passed",
        status: "passed",
        target: "staging",
        payload: JSON.stringify({
          environment: "preview",
          deploymentUrl: "https://todo-git-main-acme.vercel.app",
          commitSha: "abc123",
          status: "READY"
        }),
        now: new Date("2026-05-14T00:15:00.000Z")
      });
      const artifact = JSON.parse(await readFile(result.artifactPath, "utf8")) as {
        sources: {
          provenance: {
            target: string;
            readinessTiers: string[];
          };
        }[];
        content: string;
      };
      const content = JSON.parse(artifact.content) as {
        target: string;
        readinessTiers: string[];
        sourceKind: string;
      };

      expect(result.evidence.type).toBe("startup_release_plan");
      expect(result.target).toBe("staging");
      expect(result.readinessTiers).toEqual(["staging_deployment"]);
      expect(content).toMatchObject({
        target: "staging",
        readinessTiers: ["staging_deployment"],
        sourceKind: "vercel_deployment"
      });
      expect(artifact.sources[0]?.provenance).toMatchObject({
        target: "staging",
        readinessTiers: ["staging_deployment"]
      });
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("verifies deployment source over HTTP before recording launch evidence", async () => {
    const workspace = join(tmpdir(), `runstead-startup-source-verify-${process.pid}`);
    const fetchCalls: {
      input: string;
      method?: string;
    }[] = [];

    try {
      await rm(workspace, { force: true, recursive: true });
      await mkdir(workspace, { recursive: true });
      await writeFile(
        join(workspace, "package.json"),
        `${JSON.stringify({ name: "source-verify-fixture", private: true }, null, 2)}\n`,
        "utf8"
      );
      await startupOnboard({
        cwd: workspace,
        now: new Date("2026-05-14T00:00:00.000Z")
      });

      const result = await verifyStartupSourceEvidence({
        cwd: workspace,
        connector: "deployment",
        uri: "https://staging.example.com/health",
        expectStatus: 200,
        expectText: ["Launch OK"],
        fetch: (input, init) => {
          fetchCalls.push({
            input,
            ...(init?.method === undefined ? {} : { method: init.method })
          });
          return Promise.resolve({
            ok: true,
            status: 200,
            text: () => Promise.resolve("ready Launch OK")
          });
        },
        now: new Date("2026-05-14T00:15:00.000Z")
      });
      const artifact = JSON.parse(await readFile(result.artifactPath, "utf8")) as {
        evidenceType: string;
        content: string;
      };
      const content = JSON.parse(artifact.content) as {
        status: string;
        payload: {
          verification: {
            status: string;
            statusCode: number;
            expectedStatus: number;
            textChecks: {
              text: string;
              matched: boolean;
            }[];
          };
        };
      };

      expect(fetchCalls).toEqual([
        {
          input: "https://staging.example.com/health",
          method: "GET"
        }
      ]);
      expect(result.evidence.type).toBe("startup_release_plan");
      expect(result.verification).toMatchObject({
        status: "passed",
        ok: true,
        statusCode: 200,
        expectedStatus: 200,
        textChecks: [
          {
            text: "Launch OK",
            matched: true
          }
        ]
      });
      expect(artifact.evidenceType).toBe("release_plan");
      expect(content).toMatchObject({
        status: "passed",
        payload: {
          verification: {
            status: "passed",
            statusCode: 200,
            expectedStatus: 200,
            textChecks: [
              {
                text: "Launch OK",
                matched: true
              }
            ]
          }
        }
      });
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("records failed verification when status or expected text does not match", async () => {
    const workspace = join(
      tmpdir(),
      `runstead-startup-source-verify-failed-${process.pid}`
    );

    try {
      await rm(workspace, { force: true, recursive: true });
      await mkdir(workspace, { recursive: true });
      await writeFile(
        join(workspace, "package.json"),
        `${JSON.stringify({ name: "source-verify-failed-fixture", private: true }, null, 2)}\n`,
        "utf8"
      );
      await startupOnboard({
        cwd: workspace,
        now: new Date("2026-05-14T00:00:00.000Z")
      });

      const result = await verifyStartupSourceEvidence({
        cwd: workspace,
        connector: "observability",
        uri: "https://status.example.com/alerts",
        expectStatus: 200,
        expectText: ["all clear"],
        fetch: () =>
          Promise.resolve({
            ok: false,
            status: 503,
            text: () => Promise.resolve("degraded")
          }),
        now: new Date("2026-05-14T00:15:00.000Z")
      });
      const artifact = JSON.parse(await readFile(result.artifactPath, "utf8")) as {
        content: string;
      };
      const content = JSON.parse(artifact.content) as {
        status: string;
        payload: {
          verification: {
            status: string;
            responseExcerpt: string;
            textChecks: {
              matched: boolean;
            }[];
          };
        };
      };

      expect(result.evidence.type).toBe("startup_observability");
      expect(result.verification).toMatchObject({
        status: "failed",
        ok: false,
        statusCode: 503,
        expectedStatus: 200,
        textChecks: [
          {
            text: "all clear",
            matched: false
          }
        ],
        responseExcerpt: "degraded"
      });
      expect(content).toMatchObject({
        status: "failed",
        payload: {
          verification: {
            status: "failed",
            responseExcerpt: "degraded",
            textChecks: [
              {
                matched: false
              }
            ]
          }
        }
      });
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("records production monitoring and analytics connector targets", async () => {
    const workspace = join(tmpdir(), `runstead-startup-source-prod-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      await mkdir(workspace, { recursive: true });
      await writeFile(
        join(workspace, "package.json"),
        `${JSON.stringify({ name: "source-prod-fixture", private: true }, null, 2)}\n`,
        "utf8"
      );
      await startupOnboard({
        cwd: workspace,
        now: new Date("2026-05-14T00:00:00.000Z")
      });

      const sentry = await verifyStartupSourceEvidence({
        cwd: workspace,
        connector: "sentry",
        uri: "https://sentry.io/organizations/acme/issues/?project=todo",
        target: "production",
        expectStatus: 200,
        expectText: ["no open release blockers"],
        fetch: () =>
          Promise.resolve({
            ok: true,
            status: 200,
            text: () => Promise.resolve("no open release blockers")
          }),
        now: new Date("2026-05-14T00:15:00.000Z")
      });
      const posthog = await recordStartupSourceEvidence({
        cwd: workspace,
        connector: "posthog",
        uri: "https://app.posthog.com/project/1/insights/activation",
        summary: "Production activation funnel uses real-user analytics",
        target: "production",
        status: "passed",
        payload: JSON.stringify({
          metric: "activation",
          value: 0.42,
          window: "7d",
          realUserData: true
        }),
        now: new Date("2026-05-14T00:20:00.000Z")
      });

      expect(sentry.evidence.type).toBe("startup_monitoring_alerts");
      expect(sentry.target).toBe("production");
      expect(sentry.readinessTiers).toEqual([]);
      expect(posthog.evidence.type).toBe("startup_metric_snapshot");
      expect(posthog.target).toBe("production");
      expect(posthog.readinessTiers).toEqual(["real_user_analytics"]);
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("rejects connector payloads that are not JSON objects", async () => {
    await expect(
      recordStartupSourceEvidence({
        cwd: process.cwd(),
        connector: "analytics",
        uri: "posthog:activation",
        summary: "Bad payload",
        payload: "[1,2,3]"
      })
    ).rejects.toThrow("--payload must be a JSON object");
  });

  it("rejects unknown trust levels before writing evidence", async () => {
    await expect(
      recordStartupSourceEvidence({
        cwd: process.cwd(),
        connector: "analytics",
        uri: "posthog:activation",
        summary: "Bad trust",
        trustLevel: "root"
      })
    ).rejects.toThrow("Unsupported source trust level");
  });

  it("rejects unknown source targets before writing evidence", async () => {
    await expect(
      recordStartupSourceEvidence({
        cwd: process.cwd(),
        connector: "vercel",
        uri: "https://vercel.com/acme/todo/deployments/dpl_123",
        summary: "Bad target",
        target: "public"
      })
    ).rejects.toThrow("Unsupported startup source target");
  });
});
