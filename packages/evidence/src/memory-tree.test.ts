import { describe, expect, it } from "vitest";

import { buildEvidenceMemoryTree, formatEvidenceMemoryTree } from "./memory-tree.js";

describe("evidence memory tree", () => {
  it("groups evidence into domain, connector, type, profile, and evidence nodes", () => {
    const tree = buildEvidenceMemoryTree([
      {
        id: "ev_digest",
        type: "citation_ledger",
        subjectType: "digest",
        subjectId: "weekly-ai",
        uri: "file:.runstead/evidence/citation.json",
        summary: "Citation ledger",
        domain: "research-monitor",
        connector: "web",
        profile: "topic:ai-agents"
      },
      {
        id: "ev_archive",
        type: "archive_record",
        subjectType: "digest",
        subjectId: "weekly-ai",
        uri: "file:.runstead/evidence/archive.json",
        domain: "research-monitor",
        connector: "docs",
        profile: "topic:ai-agents"
      },
      {
        id: "ev_ci",
        type: "github_workflow_run",
        subjectType: "repository",
        subjectId: "runstead",
        uri: "github:actions/run/1",
        domain: "repo-maintenance",
        connector: "github",
        profile: "repo:runstead"
      }
    ]);

    expect(tree).toMatchObject({
      kind: "root",
      evidenceIds: ["ev_archive", "ev_ci", "ev_digest"]
    });
    expect(tree.children.map((child) => child.id)).toEqual([
      "repo-maintenance",
      "research-monitor"
    ]);
    expect(tree.children[1]?.children.map((child) => child.id)).toEqual([
      "docs",
      "web"
    ]);
    expect(
      tree.children[1]?.children[1]?.children[0]?.children[0]?.children[0]
    ).toMatchObject({
      kind: "evidence",
      id: "ev_digest",
      label: "Citation ledger",
      evidenceIds: ["ev_digest"]
    });
  });

  it("falls back to subject and manual grouping when domain or connector is absent", () => {
    const tree = buildEvidenceMemoryTree([
      {
        id: "ev_manual",
        type: "startup_decision",
        subjectType: "startup",
        subjectId: "mvp",
        uri: "file:.runstead/evidence/manual.json"
      }
    ]);

    expect(formatEvidenceMemoryTree(tree)).toContain(
      "- connector:manual (1)\n      - evidence_type:startup_decision (1)"
    );
  });

  it("rejects empty required evidence fields", () => {
    expect(() =>
      buildEvidenceMemoryTree([
        {
          id: "",
          type: "citation_ledger",
          subjectType: "digest",
          subjectId: "weekly-ai",
          uri: "file:evidence.json"
        }
      ])
    ).toThrow("Evidence memory item id cannot be empty");
  });
});
