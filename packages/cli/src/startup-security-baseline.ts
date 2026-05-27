import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { requireRunsteadStateDb } from "./runstead-root.js";
import { formatSecurityBaseline } from "./startup-automation-format.js";
import type {
  GenerateSecurityBaselineOptions,
  GenerateSecurityBaselineResult
} from "./startup-automation-types.js";
import { writeStartupStructuredArtifact } from "./startup-artifacts.js";
import { addStartupEvidence } from "./startup-evidence.js";
import {
  securityBaselineBlockers,
  securityBaselineWarnings
} from "./startup-readiness-gates.js";
import { collectLaunchSecurityRiskScan } from "./startup-security-scan.js";
import {
  changedProtectedPaths,
  existingDependencyFiles,
  findTopLevelEnvFiles
} from "./startup-workspace-hygiene.js";

export async function generateSecurityBaseline(
  options: GenerateSecurityBaselineOptions = {}
): Promise<GenerateSecurityBaselineResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const state = await requireRunsteadStateDb(cwd);
  const generatedAt = (options.now ?? new Date()).toISOString();
  const changedProtected = await changedProtectedPaths(cwd);
  const envFiles = await findTopLevelEnvFiles(cwd);
  const dependencyFiles = await existingDependencyFiles(cwd);
  const riskScan = await collectLaunchSecurityRiskScan(cwd, dependencyFiles);
  const blockers = securityBaselineBlockers(changedProtected, riskScan);
  const warnings = securityBaselineWarnings({ envFiles, dependencyFiles, riskScan });
  const markdown = formatSecurityBaseline({
    generatedAt,
    changedProtected,
    envFiles,
    dependencyFiles,
    riskScan,
    blockers,
    warnings
  });

  await mkdir(join(state.root, "startup"), { recursive: true });

  const runtimePath = join(state.root, "startup", "security-baseline.md");

  await writeFile(runtimePath, markdown, "utf8");
  const structuredFiles = [
    await writeStartupStructuredArtifact({
      kind: "startup_security_baseline",
      generatedAt,
      markdownPath: runtimePath,
      data: {
        changedProtected,
        envFiles,
        dependencyFiles,
        riskScan,
        blockers,
        warnings
      }
    })
  ];

  const evidence = await addStartupEvidence({
    cwd,
    type: "security_baseline",
    summary: `Security baseline recorded (${blockers.length} blocker${blockers.length === 1 ? "" : "s"})`,
    sourceRefs: [runtimePath, ...structuredFiles],
    content: markdown,
    ...(options.now === undefined ? {} : { now: options.now })
  });

  return {
    root: state.root,
    stateDb: state.stateDb,
    files: [runtimePath],
    structuredFiles,
    evidenceId: evidence.evidence.id,
    blockers,
    warnings,
    riskScan
  };
}
