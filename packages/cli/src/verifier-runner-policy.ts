import { access } from "node:fs/promises";
import { join } from "node:path";

import type { Task } from "@runstead/core";

import { showGoal } from "./goals.js";
import { loadPolicyProfileFromFile } from "./policy-loader.js";
import type { PolicyProfile } from "./policy.js";

export async function loadVerifierPolicy(input: {
  root: string;
  cwd: string;
  task: Task;
}): Promise<PolicyProfile> {
  const goal = showGoal({ cwd: input.cwd, id: input.task.goalId }).goal;

  for (const path of policyCandidatePaths({
    root: input.root,
    domain: goal.domain,
    ...(goal.policyRef === undefined ? {} : { policyRef: goal.policyRef })
  })) {
    if (await exists(path)) {
      return loadPolicyProfileFromFile(path);
    }
  }

  return loadPolicyProfileFromFile(
    join(input.root, "policies", "repo-maintenance.yaml")
  );
}

function policyCandidatePaths(input: {
  root: string;
  domain: string;
  policyRef?: string;
}): string[] {
  const fallback = join(input.root, "policies", "repo-maintenance.yaml");

  if (input.policyRef === undefined) {
    return [fallback];
  }

  return [
    join(input.root, input.policyRef),
    join(input.root, "domains", input.domain, input.policyRef),
    fallback
  ].filter((path, index, paths) => paths.indexOf(path) === index);
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
