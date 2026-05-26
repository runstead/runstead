import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { openRunsteadDatabase } from "@runstead/state-sqlite";

import { requireRunsteadStateDb } from "./runstead-root.js";
import { addStartupEvidence } from "./startup-evidence.js";
import {
  readCollaborationApprovals,
  readRiskAcceptances
} from "./startup-collaboration-data.js";
import { formatStartupCollaborationDigest } from "./startup-collaboration-format.js";
import type {
  GenerateStartupCollaborationDigestOptions,
  StartupCollaborationApproval,
  StartupCollaborationDigestResult,
  StartupRiskAcceptance
} from "./startup-collaboration-types.js";

export type {
  GenerateStartupCollaborationDigestOptions,
  StartupCollaborationApproval,
  StartupCollaborationDigestResult,
  StartupRiskAcceptance
} from "./startup-collaboration-types.js";

export async function generateStartupCollaborationDigest(
  options: GenerateStartupCollaborationDigestOptions = {}
): Promise<StartupCollaborationDigestResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const state = await requireRunsteadStateDb(cwd);
  const generatedAt = options.now ?? new Date();
  const expiryWindowDays = options.expiryWindowDays ?? 7;
  const database = openRunsteadDatabase(state.stateDb);

  try {
    const approvals = readCollaborationApprovals(database);
    const riskAcceptances = await readRiskAcceptances(database);
    const pendingApprovals = approvals.filter(
      (approval) => approval.status === "pending"
    );
    const expiryReminders = collaborationExpiryReminders({
      approvals: pendingApprovals,
      riskAcceptances,
      now: generatedAt,
      expiryWindowDays
    });
    const notifications = options.notify ?? [
      "github:post launch readiness summary",
      "slack:#launch-review",
      "email:founder-review"
    ];
    const digest = {
      schemaVersion: 1,
      generatedAt: generatedAt.toISOString(),
      owner: options.owner ?? "founder",
      reviewer: options.reviewer ?? "launch-reviewer",
      pendingApprovals,
      riskAcceptances,
      expiryReminders,
      notifications,
      roleViews: {
        founder: "decision summary, accepted debt, and next launch gate",
        engineer: "blockers, remediation tasks, verifier evidence, and CI status",
        ops: "SOPs, rollback, support, reminders, and owner handoffs",
        securityReviewer: "protected paths, secrets, dependencies, privacy, and waivers"
      }
    };
    const startupDir = join(state.root, "startup");
    const markdownPath = join(startupDir, "team-collaboration.md");
    const jsonPath = join(startupDir, "team-collaboration.json");

    await mkdir(startupDir, { recursive: true });
    await writeFile(markdownPath, formatStartupCollaborationDigest(digest), "utf8");
    await writeFile(jsonPath, `${JSON.stringify(digest, null, 2)}\n`, "utf8");

    const evidence = await addStartupEvidence({
      cwd,
      type: "team_collaboration",
      summary: `Startup collaboration digest recorded (${pendingApprovals.length} pending approval${pendingApprovals.length === 1 ? "" : "s"})`,
      sourceRefs: [markdownPath, jsonPath],
      content: JSON.stringify(digest, null, 2),
      ...(options.now === undefined ? {} : { now: options.now })
    });

    return {
      root: state.root,
      stateDb: state.stateDb,
      files: [markdownPath],
      jsonPath,
      evidenceId: evidence.evidence.id,
      pendingApprovals,
      riskAcceptances,
      expiryReminders,
      notifications
    };
  } finally {
    database.close();
  }
}

function collaborationExpiryReminders(input: {
  approvals: StartupCollaborationApproval[];
  riskAcceptances: StartupRiskAcceptance[];
  now: Date;
  expiryWindowDays: number;
}): string[] {
  const windowMs = input.expiryWindowDays * 24 * 60 * 60 * 1000;
  const reminders = [
    ...input.approvals.flatMap((approval) =>
      expiringReminder({
        label: `approval ${approval.id}`,
        expiresAt: approval.expiresAt,
        now: input.now,
        windowMs
      })
    ),
    ...input.riskAcceptances.flatMap((acceptance) =>
      expiringReminder({
        label: `risk acceptance ${acceptance.evidenceId}`,
        expiresAt: acceptance.expiresAt,
        now: input.now,
        windowMs
      })
    )
  ];

  return reminders.length === 0
    ? ["no approval or waiver expiry inside window"]
    : reminders;
}

function expiringReminder(input: {
  label: string;
  expiresAt: string | undefined;
  now: Date;
  windowMs: number;
}): string[] {
  if (input.expiresAt === undefined) {
    return [];
  }

  const expiresAt = new Date(input.expiresAt);
  const delta = expiresAt.getTime() - input.now.getTime();

  if (Number.isNaN(delta) || delta < 0 || delta > input.windowMs) {
    return [];
  }

  return [`${input.label} expires at ${input.expiresAt}`];
}
