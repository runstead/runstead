import type { Task, WorkerRun } from "@runstead/core";
import type { RunsteadDatabase } from "@runstead/state-sqlite";

import { gitDiffAction } from "./ci-repair-orchestrator-actions.js";
import type { CiRepairOrchestratorStageContext } from "./ci-repair-orchestrator-context.js";
import { stageAtLeast } from "./ci-repair-orchestrator-context.js";
import { diffScopeOutput } from "./ci-repair-orchestrator-output.js";
import type { CiRepairGitRunner } from "./ci-repair-orchestrator-types.js";
import {
  verifyGitDiffScope,
  type GitDiffScopeVerification
} from "./diff-scope-verifier.js";
import { runGovernedToolAction } from "./governed-action.js";
import type { PolicyProfile } from "./policy.js";

export interface ResolveCiRepairDiffScopeInput {
  cwd: string;
  stateDb: string;
  database: RunsteadDatabase;
  policy: PolicyProfile;
  task: Task;
  workerRun: WorkerRun;
  context: CiRepairOrchestratorStageContext;
  base: string;
  allowedPaths?: string[];
  deniedPaths?: string[];
  gitRunner?: CiRepairGitRunner;
  now?: Date;
}

export async function resolveCiRepairDiffScope(
  input: ResolveCiRepairDiffScopeInput
): Promise<GitDiffScopeVerification> {
  let diffScope = input.context.diffScope;

  if (!stageAtLeast(input.context.stage, "verified") || diffScope === undefined) {
    diffScope = await runGovernedToolAction({
      cwd: input.cwd,
      stateDb: input.stateDb,
      database: input.database,
      policy: input.policy,
      task: input.task,
      workerRun: input.workerRun,
      action: gitDiffAction({
        task: input.task,
        cwd: input.cwd,
        base: input.base,
        head: "HEAD"
      }),
      requestedBy: "runstead:ci-repair",
      ...(input.now === undefined ? {} : { now: input.now }),
      run: async () => {
        const value = await verifyGitDiffScope({
          cwd: input.cwd,
          baseRef: input.base,
          headRef: "HEAD",
          allowedPaths: input.allowedPaths ?? [],
          deniedPaths: input.deniedPaths ?? [],
          ...(input.gitRunner === undefined ? {} : { runner: input.gitRunner })
        });

        return {
          value,
          output: diffScopeOutput(value)
        };
      }
    }).then((result) => result.value);
  }

  if (diffScope === undefined) {
    throw new Error("CI repair diff scope context is missing");
  }

  return diffScope;
}
