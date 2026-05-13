import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { loadDomainPackBundleFromDir } from "./loader.js";

describe("loadDomainPackBundleFromDir", () => {
  it("loads goal templates and default verifier refs from a pack directory", async () => {
    const packRoot = fileURLToPath(
      new URL("../packs/repo-maintenance", import.meta.url)
    );

    const bundle = await loadDomainPackBundleFromDir(packRoot);
    const [goalTemplate] = bundle.goalTemplates;

    expect(bundle.domain.id).toBe("repo-maintenance");
    expect(bundle.defaultVerifiers).toEqual(["command", "git_diff_scope"]);
    expect(goalTemplate?.id).toBe("keep-ci-green");
    expect(goalTemplate?.domain).toBe("repo-maintenance");
    expect(goalTemplate?.generated.recurringTasks).toEqual(["run_local_verifiers"]);
    expect(goalTemplate?.generated.acceptanceContracts).toEqual([
      "tests_pass",
      "lint_pass",
      "diff_scope_clean"
    ]);
    expect(bundle.taskTypes.map((taskType) => taskType.id)).toEqual([
      "repo_inspect",
      "run_local_verifiers"
    ]);
  });
});
