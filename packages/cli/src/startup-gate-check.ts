import { resolve } from "node:path";

import { createRunsteadId, type RunsteadEvent } from "@runstead/core";
import { appendEventAndProject, openRunsteadDatabase } from "@runstead/state-sqlite";

import { requireRunsteadStateDb } from "./runstead-root.js";
import { readStartupGateEvidenceArtifacts } from "./startup-gate-artifact-store.js";
import { evaluateStartupGate } from "./startup-gate-evaluation.js";
import {
  readPreviousStartupGateEvent,
  readStartupGateEvidence,
  readStartupGateTasks
} from "./startup-gate-state.js";
import type { StartupGateStage } from "./startup-evidence-types.js";
import type {
  StartupGateDiff,
  StartupGateFinding,
  StartupGateWaiver
} from "./startup-gate-types.js";

const STARTUP_DOMAIN = "ai-native-startup";

export interface CheckStartupGateOptions {
  cwd?: string;
  domain?: string;
  stage?: StartupGateStage;
  now?: Date;
  recordEvent?: boolean;
}

export interface StartupGateCheckResult {
  root: string;
  stateDb: string;
  domain: string;
  stage: StartupGateStage;
  passed: boolean;
  blockers: string[];
  warnings: string[];
  findings: StartupGateFinding[];
  waivedBlockers: StartupGateWaiver[];
  diff: StartupGateDiff;
  event: RunsteadEvent;
}

export async function checkStartupGate(
  options: CheckStartupGateOptions = {}
): Promise<StartupGateCheckResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const domain = options.domain ?? STARTUP_DOMAIN;
  const stage = options.stage ?? "launch";
  const checkedAt = (options.now ?? new Date()).toISOString();
  const resolvedState = await requireRunsteadStateDb(cwd);
  const database = openRunsteadDatabase(resolvedState.stateDb);

  try {
    const tasks = readStartupGateTasks(database, domain);
    const evidence = readStartupGateEvidence(database, domain);
    const artifacts = readStartupGateEvidenceArtifacts(evidence);
    const previousEvent = readPreviousStartupGateEvent(database, domain, stage);
    const gate = evaluateStartupGate({
      stage,
      tasks,
      evidence,
      artifacts,
      checkedAt,
      ...(previousEvent === undefined ? {} : { previousEvent })
    });
    const event: RunsteadEvent = {
      eventId: createRunsteadId("evt"),
      type: "startup_gate.checked",
      aggregateType: "startup_gate",
      aggregateId: `${domain}_${stage}`,
      payload: {
        domain,
        stage,
        passed: gate.passed,
        blockers: gate.blockers,
        warnings: gate.warnings,
        findings: gate.findings,
        waivedBlockers: gate.waivedBlockers,
        diff: gate.diff
      },
      createdAt: checkedAt
    };

    if (options.recordEvent !== false) {
      appendEventAndProject(database, { event });
    }

    return {
      root: resolvedState.root,
      stateDb: resolvedState.stateDb,
      domain,
      stage,
      passed: gate.passed,
      blockers: gate.blockers,
      warnings: gate.warnings,
      findings: gate.findings,
      waivedBlockers: gate.waivedBlockers,
      diff: gate.diff,
      event
    };
  } finally {
    database.close();
  }
}
