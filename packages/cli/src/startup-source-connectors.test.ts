import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { startupOnboard } from "./startup-founder-flow.js";
import { collectRecordedStartupReadinessEvidence } from "./startup-ready/evidence.js";
import {
  createStartupSourceRefreshPlan,
  formatStartupSourceRefreshPlan
} from "./startup-source-refresh-plan.js";
import {
  collectStartupSourceEvidence,
  getStartupSourceProviderAdapter,
  listStartupSourceConnectorDefinitions,
  recordStartupSourceEvidence,
  STARTUP_SOURCE_CONNECTORS,
  startupSourceConnectorReadinessEvidenceRequirements,
  startupSourceConnectorRequirementBlockers,
  startupSourceConnectorRequirementsForTarget,
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

  it("collects GitHub Actions evidence through the executable adapter", async () => {
    const workspace = join(tmpdir(), `runstead-startup-source-gh-${process.pid}`);
    const fetchCalls: {
      input: string;
      auth?: string;
    }[] = [];

    try {
      await rm(workspace, { force: true, recursive: true });
      await mkdir(workspace, { recursive: true });
      await writeFile(
        join(workspace, "package.json"),
        `${JSON.stringify({ name: "source-gh-fixture", private: true }, null, 2)}\n`,
        "utf8"
      );
      await startupOnboard({
        cwd: workspace,
        now: new Date("2026-05-14T00:00:00.000Z")
      });

      const result = await collectStartupSourceEvidence({
        cwd: workspace,
        connector: "github_actions",
        uri: "https://api.github.com/repos/acme/todo/actions/runs/123",
        token: "ghs_redacted",
        target: "staging",
        fetch: (input, init) => {
          fetchCalls.push({
            input,
            ...(init?.headers?.Authorization === undefined
              ? {}
              : { auth: init.headers.Authorization })
          });
          return Promise.resolve({
            ok: true,
            status: 200,
            text: () =>
              Promise.resolve(
                JSON.stringify({
                  workflow: "launch",
                  conclusion: "success",
                  status: "completed",
                  head_sha: "abc123",
                  id: 123
                })
              )
          });
        },
        now: new Date("2026-05-14T00:15:00.000Z")
      });
      const artifact = JSON.parse(await readFile(result.artifactPath, "utf8")) as {
        content: string;
      };
      const content = JSON.parse(artifact.content) as {
        status: string;
        payload: {
          workflow: string;
          conclusion: string;
        };
      };

      expect(getStartupSourceProviderAdapter("github_actions")).toMatchObject({
        provider: "github",
        requiredTokenEnv: "GITHUB_TOKEN"
      });
      expect(getStartupSourceProviderAdapter("gitlab_ci")).toMatchObject({
        provider: "gitlab",
        requiredTokenEnv: "GITLAB_TOKEN"
      });
      expect(fetchCalls).toEqual([
        {
          input: "https://api.github.com/repos/acme/todo/actions/runs/123",
          auth: "Bearer ghs_redacted"
        }
      ]);
      expect(result.adapter.provider).toBe("github");
      expect(result.collection.status).toBe("passed");
      expect(result.readinessTiers).toEqual(["ci_verified"]);
      expect(content).toMatchObject({
        status: "passed",
        payload: {
          workflow: "launch",
          conclusion: "success"
        }
      });
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("collects deployment and production metric adapters offline", async () => {
    const workspace = join(tmpdir(), `runstead-startup-source-adapters-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      await mkdir(workspace, { recursive: true });
      await writeFile(
        join(workspace, "package.json"),
        `${JSON.stringify({ name: "source-adapters-fixture", private: true }, null, 2)}\n`,
        "utf8"
      );
      await startupOnboard({
        cwd: workspace,
        now: new Date("2026-05-14T00:00:00.000Z")
      });

      const vercel = await collectStartupSourceEvidence({
        cwd: workspace,
        connector: "vercel",
        uri: "https://api.vercel.com/v13/deployments/dpl_123",
        target: "staging",
        fetch: () =>
          Promise.resolve({
            ok: true,
            status: 200,
            text: () =>
              Promise.resolve(
                JSON.stringify({
                  readyState: "READY",
                  deploymentUrl: "https://todo.vercel.app",
                  commitSha: "abc123"
                })
              )
          }),
        now: new Date("2026-05-14T00:15:00.000Z")
      });
      const sentry = await collectStartupSourceEvidence({
        cwd: workspace,
        connector: "sentry",
        uri: "https://sentry.io/api/0/projects/acme/todo/releases/1.0/",
        target: "production",
        fetch: () =>
          Promise.resolve({
            ok: true,
            status: 200,
            text: () =>
              Promise.resolve(
                JSON.stringify({
                  project: "todo",
                  release: "1.0",
                  openReleaseBlockers: 0
                })
              )
          }),
        now: new Date("2026-05-14T00:20:00.000Z")
      });
      const posthog = await collectStartupSourceEvidence({
        cwd: workspace,
        connector: "posthog",
        uri: "https://app.posthog.com/api/projects/1/insights/activation",
        target: "production",
        fetch: () =>
          Promise.resolve({
            ok: true,
            status: 200,
            text: () =>
              Promise.resolve(
                JSON.stringify({
                  metric: "activation",
                  value: 0.42,
                  threshold: 0.3,
                  window: "7d",
                  realUserData: true
                })
              )
          }),
        now: new Date("2026-05-14T00:25:00.000Z")
      });

      expect(vercel.collection).toMatchObject({
        status: "passed",
        summary: "Vercel Deployment deployment READY"
      });
      expect(vercel.readinessTiers).toEqual(["staging_deployment"]);
      expect(sentry.collection).toMatchObject({
        status: "passed",
        summary: "Sentry release blockers: 0"
      });
      expect(posthog.collection).toMatchObject({
        status: "passed",
        payload: {
          metric: "activation",
          value: 0.42,
          threshold: 0.3,
          realUserData: true
        }
      });
      expect(posthog.readinessTiers).toEqual(["real_user_analytics"]);
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("classifies provider adapter edge states and redacts collected secrets", async () => {
    const workspace = join(
      tmpdir(),
      `runstead-startup-source-adapter-states-${process.pid}`
    );

    try {
      await rm(workspace, { force: true, recursive: true });
      await mkdir(workspace, { recursive: true });
      await writeFile(
        join(workspace, "package.json"),
        `${JSON.stringify({ name: "source-adapter-states-fixture", private: true }, null, 2)}\n`,
        "utf8"
      );
      await startupOnboard({
        cwd: workspace,
        now: new Date("2026-05-14T00:00:00.000Z")
      });

      const pendingGithub = await collectStartupSourceEvidence({
        cwd: workspace,
        connector: "github_actions",
        uri: "https://api.github.com/repos/acme/todo/actions/runs/124",
        fetch: () =>
          Promise.resolve({
            ok: true,
            status: 200,
            text: () =>
              Promise.resolve(
                JSON.stringify({
                  workflow: "launch",
                  status: "in_progress",
                  head_sha: "abc123",
                  id: 124
                })
              )
          })
      });
      const failedRender = await collectStartupSourceEvidence({
        cwd: workspace,
        connector: "render",
        uri: "https://api.render.com/v1/services/srv/deploys/dep",
        target: "staging",
        fetch: () =>
          Promise.resolve({
            ok: true,
            status: 200,
            text: () =>
              Promise.resolve(
                JSON.stringify({
                  status: "failed",
                  url: "https://todo.onrender.com",
                  commit: "abc123"
                })
              )
          })
      });
      const unknownSentry = await collectStartupSourceEvidence({
        cwd: workspace,
        connector: "sentry",
        uri: "https://sentry.io/api/0/projects/acme/todo/releases/1.0/",
        fetch: () =>
          Promise.resolve({
            ok: true,
            status: 200,
            text: () =>
              Promise.resolve(
                JSON.stringify({
                  project: "todo",
                  release: "1.0"
                })
              )
          })
      });
      const syntheticPosthog = await collectStartupSourceEvidence({
        cwd: workspace,
        connector: "posthog",
        uri: "https://app.posthog.com/api/projects/1/insights/activation",
        target: "production",
        fetch: () =>
          Promise.resolve({
            ok: true,
            status: 200,
            text: () =>
              Promise.resolve(
                JSON.stringify({
                  metric: "activation",
                  value: 0.5,
                  threshold: 0.3,
                  realUserData: false
                })
              )
          })
      });
      const httpFailure = await collectStartupSourceEvidence({
        cwd: workspace,
        connector: "vercel",
        uri: "https://api.vercel.com/v13/deployments/dpl_failed",
        token: "vc_secret_token",
        fetch: () =>
          Promise.resolve({
            ok: false,
            status: 401,
            text: () =>
              Promise.resolve(
                JSON.stringify({
                  error: "unauthorized",
                  token: "vc_secret_token",
                  nested: {
                    authorization: "Bearer vc_secret_token",
                    note: "request token vc_secret_token leaked by fixture"
                  }
                })
              )
          })
      });
      const malformed = await collectStartupSourceEvidence({
        cwd: workspace,
        connector: "vercel",
        uri: "https://api.vercel.com/v13/deployments/dpl_malformed",
        token: "vc_secret_token",
        fetch: () =>
          Promise.resolve({
            ok: true,
            status: 200,
            text: () => Promise.resolve("not-json vc_secret_token")
          })
      });
      const httpFailureArtifact = await readFile(httpFailure.artifactPath, "utf8");
      const malformedArtifact = await readFile(malformed.artifactPath, "utf8");
      const recordedEvidence = await collectRecordedStartupReadinessEvidence(workspace);

      expect(pendingGithub.collection).toMatchObject({
        status: "unknown",
        summary: "GitHub Actions workflow launch in_progress"
      });
      expect(failedRender.collection).toMatchObject({
        status: "failed",
        summary: "Render Deployment deployment failed"
      });
      expect(failedRender.readinessTiers).toEqual([]);
      expect(unknownSentry.collection).toMatchObject({
        status: "unknown",
        summary: "Sentry release blockers: unknown"
      });
      expect(syntheticPosthog.collection).toMatchObject({
        status: "failed",
        payload: {
          metric: "activation",
          value: 0.5,
          threshold: 0.3,
          realUserData: false
        }
      });
      expect(syntheticPosthog.readinessTiers).toEqual([]);
      expect(httpFailure.collection).toMatchObject({
        status: "failed",
        payload: {
          response: {
            token: "[redacted]",
            nested: {
              authorization: "[redacted]",
              note: "request token [redacted] leaked by fixture"
            }
          }
        }
      });
      expect(malformed.collection).toMatchObject({
        status: "failed",
        summary: "Vercel Deployment adapter returned invalid JSON",
        payload: {
          responseExcerpt: "not-json [redacted]"
        }
      });
      expect(recordedEvidence.evidenceTiers).not.toContain("staging_deployment");
      expect(recordedEvidence.evidenceTiers).not.toContain("real_user_analytics");
      expect(httpFailureArtifact).not.toContain("vc_secret_token");
      expect(malformedArtifact).not.toContain("vc_secret_token");
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
          connector: "gitlab_ci",
          evidenceType: "repo_readiness",
          sourceKind: "gitlab_ci"
        }),
        expect.objectContaining({
          connector: "linear",
          evidenceType: "team_collaboration",
          sourceKind: "linear_issue"
        }),
        expect.objectContaining({
          connector: "jira",
          evidenceType: "team_collaboration",
          sourceKind: "jira_issue"
        }),
        expect.objectContaining({
          connector: "slack",
          evidenceType: "team_collaboration",
          sourceKind: "slack_thread"
        }),
        expect.objectContaining({
          connector: "docs",
          evidenceType: "institutional_memory",
          sourceKind: "workspace_doc"
        }),
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

  it("turns staging and production provider setup into readiness requirements", () => {
    const staging = startupSourceConnectorRequirementsForTarget({
      target: "staging",
      env: {}
    });
    const configuredStaging = startupSourceConnectorRequirementsForTarget({
      target: "staging",
      env: {
        GITHUB_TOKEN: "ghs_fixture",
        RENDER_API_KEY: "rnd_fixture",
        SENTRY_AUTH_TOKEN: "sentry_fixture"
      }
    });
    const production = startupSourceConnectorRequirementsForTarget({
      target: "production",
      env: {}
    });
    const productionRequirements =
      startupSourceConnectorReadinessEvidenceRequirements(production);

    expect(startupSourceConnectorRequirementsForTarget({ target: "local" })).toEqual(
      []
    );
    expect(staging.map((requirement) => requirement.id)).toEqual([
      "remote-ci",
      "deployment-provider",
      "monitoring-provider"
    ]);
    expect(startupSourceConnectorRequirementBlockers(staging)).toEqual(
      expect.arrayContaining([
        "Remote CI status connector requires one of GITHUB_TOKEN, GITLAB_TOKEN for staging readiness",
        "staging deployment provider connector requires one of VERCEL_TOKEN, RENDER_API_KEY for staging readiness",
        "Monitoring provider connector requires SENTRY_AUTH_TOKEN for staging readiness"
      ])
    );
    expect(startupSourceConnectorRequirementBlockers(configuredStaging)).toEqual([]);
    expect(production.map((requirement) => requirement.id)).toEqual([
      "remote-ci",
      "deployment-provider",
      "monitoring-provider",
      "analytics-provider"
    ]);
    expect(productionRequirements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "startup_source",
          sourceId: "remote-ci",
          targets: ["production"],
          evidenceTiers: ["ci_verified"],
          evidenceTypes: ["startup_repo_readiness"],
          blockers: [
            "Remote CI status connector requires one of GITHUB_TOKEN, GITLAB_TOKEN for production readiness"
          ]
        }),
        expect.objectContaining({
          source: "startup_source",
          sourceId: "analytics-provider",
          targets: ["production"],
          evidenceTiers: ["real_user_analytics"],
          evidenceTypes: ["startup_metric_snapshot"],
          blockers: [
            "Real-user analytics provider connector requires POSTHOG_API_KEY for production readiness"
          ]
        })
      ])
    );
  });

  it("plans target source connector refresh commands with freshness windows", () => {
    const plan = createStartupSourceRefreshPlan({
      target: "production",
      env: {
        GITHUB_TOKEN: "ghs_fixture",
        RENDER_API_KEY: "rnd_fixture",
        SENTRY_AUTH_TOKEN: "sentry_fixture"
      }
    });

    expect(plan.blockers).toEqual([
      "Real-user analytics provider connector requires POSTHOG_API_KEY for production readiness"
    ]);
    const deployment = plan.requirements.find(
      (requirement) => requirement.id === "deployment-provider"
    );
    const renderConnector = deployment?.connectors.find(
      (connector) => connector.connector === "render"
    );
    const analytics = plan.requirements.find(
      (requirement) => requirement.id === "analytics-provider"
    );
    const posthogConnector = analytics?.connectors[0];

    expect(renderConnector).toEqual({
      connector: "render",
      displayName: "Render Deployment",
      adapterProvider: "render",
      requiredTokenEnv: "RENDER_API_KEY",
      defaultFreshnessDays: 7,
      collectCommand:
        "runstead startup source collect --connector render --target production --source-uri <provider-api-url>"
    });
    expect(posthogConnector).toEqual(
      expect.objectContaining({
        connector: "posthog",
        adapterProvider: "posthog",
        requiredTokenEnv: "POSTHOG_API_KEY",
        defaultFreshnessDays: 14,
        collectCommand:
          "runstead startup source collect --connector posthog --target production --posthog-environment <environment-id> --posthog-insight <insight-id>"
      })
    );
    expect(formatStartupSourceRefreshPlan(plan)).toContain(
      "posthog: freshness=14d adapter=posthog"
    );

    const workspacePlan = createStartupSourceRefreshPlan({
      cwd: "/tmp/runstead source workspace",
      target: "staging",
      env: {
        GITHUB_TOKEN: "ghs_fixture",
        VERCEL_TOKEN: "vercel_fixture",
        SENTRY_AUTH_TOKEN: "sentry_fixture"
      }
    });
    const github = workspacePlan.requirements
      .find((requirement) => requirement.id === "remote-ci")
      ?.connectors.find((connector) => connector.connector === "github_actions");

    expect(github?.collectCommand).toBe(
      "runstead startup source collect --cwd '/tmp/runstead source workspace' --connector github_actions --target staging --github-repo <owner/repo> --github-run-id <run-id>"
    );
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
