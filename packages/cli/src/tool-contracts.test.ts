import { describe, expect, it } from "vitest";

import {
  getToolContract,
  listToolContracts,
  requireToolContract
} from "./tool-contracts.js";

describe("tool contract registry", () => {
  it("lists known tool contracts", () => {
    const contracts = listToolContracts();

    expect(contracts.map((contract) => contract.actionType)).toEqual(
      expect.arrayContaining([
        "shell.exec",
        "filesystem.read",
        "filesystem.write",
        "git.status",
        "git.diff",
        "git.branch.create",
        "git.commit",
        "git.push",
        "github.run.read",
        "github.run.log.read",
        "package.install",
        "package.update",
        "github.pr.create",
        "worker.external.start",
        "checkpoint.create",
        "checkpoint.restore"
      ])
    );
  });

  it("returns defensive copies", () => {
    const contract = requireToolContract("shell.exec");

    contract.sideEffects.push("mutated");

    expect(requireToolContract("shell.exec").sideEffects).not.toContain("mutated");
  });

  it("describes external write side effects", () => {
    expect(getToolContract("github.pr.create")).toMatchObject({
      actionType: "github.pr.create",
      tool: "github",
      sideEffects: ["network_write_external", "github_pr_create"],
      evidenceRequired: true,
      policyRequired: true
    });
    expect(getToolContract("git.push")).toMatchObject({
      actionType: "git.push",
      tool: "git",
      sideEffects: ["network_write_external", "git_push"],
      evidenceRequired: true,
      policyRequired: true
    });
  });

  it("throws for unknown required contracts", () => {
    expect(() => requireToolContract("unknown.action")).toThrow(
      "Tool contract not found"
    );
  });
});
