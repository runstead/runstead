import { domainPackToWorkPack } from "@runstead/domain-packs";
import { describe, expect, it } from "vitest";

import { evaluateWorkPackInteractionSurface } from "./work-pack-interaction-surface.js";

describe("work pack interaction surface", () => {
  it("maps approvals, evidence writes, scheduled checks, and webhook intake to entrypoints", () => {
    const workPack = domainPackToWorkPack({
      id: "customer-ops",
      version: "0.1.0",
      name: "Customer Ops",
      description: "Handle customer operations with governed workers.",
      compatibility: {
        runsteadMinVersion: "0.0.0"
      },
      goalTemplates: ["daily-inbox"],
      taskTypes: ["triage_thread"],
      defaultPolicy: "policies/default.yaml",
      defaultVerifiers: ["command"],
      requiredTools: ["filesystem"],
      supportedWorkers: ["codex_cli"]
    });

    expect(evaluateWorkPackInteractionSurface(workPack).interactions).toEqual([
      expect.objectContaining({
        kind: "approval",
        status: "implemented",
        entrypoint: "cli-run",
        environment: "local"
      }),
      expect.objectContaining({
        kind: "evidence",
        status: "implemented",
        entrypoint: "cli-run",
        environment: "local"
      }),
      expect.objectContaining({
        kind: "scheduled_check",
        status: "modeled",
        entrypoint: "scheduled-check",
        environment: "team-control-plane"
      }),
      expect.objectContaining({
        kind: "webhook_intake",
        status: "modeled",
        entrypoint: "webhook-gateway",
        environment: "team-control-plane"
      })
    ]);
  });

  it("distinguishes entrypoint contracts from runtime capability gaps", () => {
    const workPack = {
      schemaVersion: 1 as const,
      id: "minimal",
      version: "0.1.0",
      name: "Minimal",
      description: "Minimal pack.",
      source: "inline" as const,
      domain: {
        kind: "domain_pack" as const,
        id: "minimal"
      },
      extensions: [],
      skills: [],
      workflows: [
        {
          id: "run",
          kind: "goal_template" as const,
          source: "test"
        }
      ],
      runtimeEnvironments: [
        {
          id: "local",
          kind: "local" as const,
          backend: "sqlite" as const,
          workers: [],
          capabilities: []
        }
      ],
      entrypoints: [
        {
          id: "cli-run",
          kind: "cli" as const,
          status: "implemented" as const,
          environment: "local",
          workflows: ["run"],
          accepts: ["approvals" as const]
        }
      ],
      resourceTypes: [],
      supportedWorkers: []
    };

    expect(evaluateWorkPackInteractionSurface(workPack).interactions).toEqual([
      expect.objectContaining({
        kind: "approval",
        status: "missing_runtime_capability",
        entrypoint: "cli-run"
      }),
      expect.objectContaining({
        kind: "evidence",
        status: "missing_entrypoint"
      }),
      expect.objectContaining({
        kind: "scheduled_check",
        status: "missing_entrypoint"
      }),
      expect.objectContaining({
        kind: "webhook_intake",
        status: "missing_entrypoint"
      })
    ]);
  });
});
