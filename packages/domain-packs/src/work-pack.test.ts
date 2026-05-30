import { describe, expect, it } from "vitest";

import {
  domainPackRegistryEntryToWorkPack,
  domainPackToWorkPack,
  resolveDomainPackRef
} from "./index.js";

describe("work packs", () => {
  it("projects a domain pack into the unified work pack model", async () => {
    const entry = await resolveDomainPackRef("research-monitor");
    const workPack = domainPackRegistryEntryToWorkPack(entry, {
      extensions: [
        {
          kind: "extension",
          id: "web-research-collector",
          label: "Web research collector"
        }
      ],
      skills: [
        {
          kind: "skill",
          id: "research-digest-reviewer",
          label: "Research digest reviewer"
        }
      ]
    });

    expect(workPack).toMatchObject({
      schemaVersion: 1,
      id: "research-monitor",
      source: "built_in",
      domain: {
        kind: "domain_pack",
        id: "research-monitor"
      },
      extensions: [
        {
          kind: "extension",
          id: "web-research-collector"
        }
      ],
      skills: [
        {
          kind: "skill",
          id: "research-digest-reviewer"
        }
      ]
    });
    expect(workPack.workflows.map((workflow) => workflow.id)).toEqual(
      expect.arrayContaining(["weekly-research-digest", "scan_sources"])
    );
    expect(workPack.resourceTypes).toContain("digest");
    expect(workPack.supportedWorkers).toContain("codex_cli");
  });

  it("keeps extensions and skills optional for current domain-only packs", () => {
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

    expect(workPack.extensions).toEqual([]);
    expect(workPack.skills).toEqual([]);
    expect(workPack.workflows).toEqual([
      {
        id: "daily-inbox",
        kind: "goal_template",
        source: "domain.goalTemplates"
      },
      {
        id: "triage_thread",
        kind: "task_type",
        source: "domain.taskTypes"
      }
    ]);
  });
});
