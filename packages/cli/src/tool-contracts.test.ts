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
        "filesystem.list",
        "filesystem.search",
        "filesystem.stat",
        "filesystem.write",
        "filesystem.patch",
        "git.status",
        "git.diff",
        "git.log",
        "git.show",
        "git.branch.create",
        "git.commit",
        "git.push",
        "github.run.read",
        "github.run.log.read",
        "repo.metadata.read",
        "verifier.run",
        "package.install",
        "package.update",
        "github.pr.create",
        "repo.publish_repair",
        "worker.external.start",
        "worker.native.start",
        "model.inference.request",
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
    expect(getToolContract("repo.publish_repair")).toMatchObject({
      actionType: "repo.publish_repair",
      tool: "runstead",
      sideEffects: ["network_write_external", "git_push", "github_pr_create"],
      evidenceRequired: true,
      policyRequired: true
    });
    expect(getToolContract("model.inference.request")).toMatchObject({
      actionType: "model.inference.request",
      tool: "model-provider",
      sideEffects: ["network_write_external", "llm_data_egress"],
      evidenceRequired: true,
      policyRequired: true
    });
  });

  it("describes native worker proxy side effects", () => {
    expect(getToolContract("worker.native.start")).toMatchObject({
      actionType: "worker.native.start",
      tool: "worker",
      sideEffects: ["execute_process", "write_workspace", "governed_tool_proxy"],
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
