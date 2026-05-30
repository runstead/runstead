import { describe, expect, it } from "vitest";

import { evaluateSkillReadiness } from "./readiness.js";
import { parseSkillPackageYaml } from "./skill-package.js";

describe("skill readiness", () => {
  it("reports ready when declared platform, env, connector, tool, and worker requirements are satisfied", () => {
    const skill = parseSkillPackageYaml({
      ...baseSkillYaml(),
      readiness: {
        platforms: ["linux"],
        required_env: [{ name: "GITHUB_TOKEN", purpose: "GitHub evidence" }],
        required_connectors: ["github"],
        required_tools: ["filesystem.read"],
        required_workers: ["codex_cli"]
      }
    });

    expect(
      evaluateSkillReadiness({
        skill,
        platform: "linux",
        env: {
          GITHUB_TOKEN: "token"
        },
        availableConnectors: ["github"],
        availableTools: ["filesystem.read"],
        availableWorkers: ["codex_cli"]
      })
    ).toMatchObject({
      skill: "fix-pnpm-ci-failures",
      status: "ready",
      missingEnv: []
    });
  });

  it("keeps missing requirements explicit for operator plans", () => {
    const skill = parseSkillPackageYaml({
      ...baseSkillYaml(),
      readiness: {
        required_env: [{ name: "EMAIL_READ_TOKEN" }],
        required_connectors: ["email"],
        required_tools: ["mailbox.read"],
        required_workers: ["codex_cli"]
      }
    });

    const verdict = evaluateSkillReadiness({
      skill,
      env: {},
      availableConnectors: [],
      availableTools: ["filesystem.read"],
      availableWorkers: []
    });

    expect(verdict).toMatchObject({
      status: "missing_requirements",
      missingEnv: ["EMAIL_READ_TOKEN"],
      missingConnectors: ["email"],
      missingTools: ["mailbox.read"],
      missingWorkers: ["codex_cli"]
    });
    expect(verdict.reason).toContain("missing env: EMAIL_READ_TOKEN");
  });

  it("suppresses fallback skills when primary connector or tool support exists", () => {
    const skill = parseSkillPackageYaml({
      ...baseSkillYaml(),
      readiness: {
        fallback_for_connectors: ["web"],
        fallback_for_tools: ["browser.navigate"]
      }
    });

    expect(
      evaluateSkillReadiness({
        skill,
        availableConnectors: ["web"],
        availableTools: ["browser.navigate"]
      })
    ).toMatchObject({
      status: "fallback_suppressed",
      suppressedByConnectors: ["web"],
      suppressedByTools: ["browser.navigate"]
    });
  });

  it("rejects unsupported platforms before checking other requirements", () => {
    const skill = parseSkillPackageYaml({
      ...baseSkillYaml(),
      readiness: {
        platforms: ["windows"],
        required_env: [{ name: "GITHUB_TOKEN" }]
      }
    });

    expect(
      evaluateSkillReadiness({
        skill,
        platform: "linux",
        env: {}
      })
    ).toMatchObject({
      status: "platform_unsupported",
      missingEnv: []
    });
  });
});

function baseSkillYaml(): Record<string, unknown> {
  return {
    name: "fix-pnpm-ci-failures",
    version: "0.1.0",
    status: "candidate",
    domain: "repo-maintenance",
    description: "Diagnose pnpm failures.",
    triggers: ["ci_failure"],
    allowed_tools: ["filesystem.read"],
    denied_tools: ["secret.read"],
    permissions: {
      network: "deny_by_default"
    },
    verifiers: [{ command: "pnpm test" }],
    provenance: {
      created_from_tasks: ["task_001"],
      author: "agent-curator"
    }
  };
}
