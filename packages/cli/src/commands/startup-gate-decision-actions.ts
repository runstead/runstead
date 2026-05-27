import { requireRbacPermission } from "../cli-rbac.js";
import {
  parseStartupGateDecision,
  parseStartupGateStage
} from "../startup-command-parsers.js";

export interface StartupGateWaiveCommandOptions {
  cwd?: string;
  stage: string;
  domain: string;
  blocker: string;
  owner: string;
  reason: string;
  comment?: string;
  expiresAt: string;
  actor: string;
}

export interface StartupGateDecideCommandOptions {
  cwd?: string;
  stage: string;
  domain: string;
  decision: string;
  reason: string;
  owner?: string;
  comment?: string;
  actor: string;
}

export async function runStartupGateWaiveCommand(
  options: StartupGateWaiveCommandOptions
): Promise<void> {
  await requireRbacPermission({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    actor: options.actor,
    permission: "evidence.write",
    action: "record startup gate waiver"
  });

  const { recordStartupGateDecision } = await import("../startup-evidence.js");
  const result = await recordStartupGateDecision({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    domain: options.domain,
    stage: parseStartupGateStage(options.stage),
    decision: "waive_blocker",
    blocker: options.blocker,
    owner: options.owner,
    reason: options.reason,
    ...(options.comment === undefined ? {} : { comment: options.comment }),
    expiresAt: options.expiresAt
  });

  console.log(`Recorded gate waiver: ${result.evidence.id}`);
  console.log(`Artifact: ${result.artifactPath}`);
}

export async function runStartupGateDecideCommand(
  options: StartupGateDecideCommandOptions
): Promise<void> {
  await requireRbacPermission({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    actor: options.actor,
    permission: "evidence.write",
    action: "record startup gate decision"
  });

  const { recordStartupGateDecision } = await import("../startup-evidence.js");
  const result = await recordStartupGateDecision({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    domain: options.domain,
    stage: parseStartupGateStage(options.stage),
    decision: parseStartupGateDecision(options.decision),
    reason: options.reason,
    ...(options.comment === undefined ? {} : { comment: options.comment }),
    ...(options.owner === undefined ? {} : { owner: options.owner })
  });

  console.log(`Recorded gate decision: ${result.evidence.id}`);
  console.log(`Artifact: ${result.artifactPath}`);
}
