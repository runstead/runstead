import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { openRunsteadDatabase } from "@runstead/state-sqlite";

import { requireRunsteadStateDb } from "./runstead-root.js";
import { addStartupEvidence } from "./startup-evidence.js";

export interface GenerateStartupCollaborationDigestOptions {
  cwd?: string;
  owner?: string;
  reviewer?: string;
  notify?: string[];
  expiryWindowDays?: number;
  now?: Date;
}

export interface StartupCollaborationDigestResult {
  root: string;
  stateDb: string;
  files: string[];
  jsonPath: string;
  evidenceId: string;
  pendingApprovals: StartupCollaborationApproval[];
  riskAcceptances: StartupRiskAcceptance[];
  expiryReminders: string[];
  notifications: string[];
}

export interface StartupCollaborationApproval {
  id: string;
  status: string;
  risk: string;
  reason: string;
  actionId: string;
  requestedBy: string;
  expiresAt?: string;
  decidedBy?: string;
}

export interface StartupRiskAcceptance {
  evidenceId: string;
  gate: string;
  decision: string;
  reason: string;
  owner: string;
  blocker?: string;
  expiresAt?: string;
  comment?: string;
}

interface ApprovalRow {
  id: string;
  status: string;
  risk: string;
  reason: string;
  action_id: string;
  requested_by: string | null;
  expires_at: string | null;
  decided_by: string | null;
}

interface EvidenceRow {
  id: string;
  uri: string;
  summary: string | null;
}

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

function readCollaborationApprovals(
  database: ReturnType<typeof openRunsteadDatabase>
): StartupCollaborationApproval[] {
  const rows = database
    .prepare(
      `
      SELECT id, status, risk, reason, action_id, requested_by, expires_at, decided_by
      FROM approvals
      ORDER BY created_at DESC, id ASC
    `
    )
    .all() as unknown as ApprovalRow[];

  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    risk: row.risk,
    reason: row.reason,
    actionId: row.action_id,
    requestedBy: row.requested_by ?? "unknown",
    ...(row.expires_at === null ? {} : { expiresAt: row.expires_at }),
    ...(row.decided_by === null ? {} : { decidedBy: row.decided_by })
  }));
}

async function readRiskAcceptances(
  database: ReturnType<typeof openRunsteadDatabase>
): Promise<StartupRiskAcceptance[]> {
  const rows = database
    .prepare(
      `
      SELECT id, uri, summary
      FROM evidence
      WHERE type = 'startup_decision'
      ORDER BY created_at DESC, id ASC
    `
    )
    .all() as unknown as EvidenceRow[];
  const acceptances: StartupRiskAcceptance[] = [];

  for (const row of rows) {
    const content = await readStartupEvidenceContent(row);

    if (!isRecord(content)) {
      continue;
    }

    if (
      content.kind !== "gate_waiver" &&
      content.decision !== "launch_with_accepted_debt"
    ) {
      continue;
    }

    acceptances.push({
      evidenceId: row.id,
      gate: stringValue(content.gate, "unknown"),
      decision: stringValue(content.decision, "unknown"),
      reason: stringValue(content.reason, row.summary ?? "no reason recorded"),
      owner: stringValue(content.owner, "unassigned"),
      ...(typeof content.blocker === "string" ? { blocker: content.blocker } : {}),
      ...(typeof content.expiresAt === "string"
        ? { expiresAt: content.expiresAt }
        : {}),
      ...(typeof content.comment === "string" ? { comment: content.comment } : {})
    });
  }

  return acceptances;
}

async function readStartupEvidenceContent(row: EvidenceRow): Promise<unknown> {
  try {
    const artifact = JSON.parse(
      await readFile(fileURLToPath(row.uri), "utf8")
    ) as unknown;

    if (!isRecord(artifact) || typeof artifact.content !== "string") {
      return undefined;
    }

    return JSON.parse(artifact.content) as unknown;
  } catch {
    return undefined;
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

function formatStartupCollaborationDigest(input: {
  generatedAt: string;
  owner: string;
  reviewer: string;
  pendingApprovals: StartupCollaborationApproval[];
  riskAcceptances: StartupRiskAcceptance[];
  expiryReminders: string[];
  notifications: string[];
  roleViews: Record<string, string>;
}): string {
  return [
    "# Startup Team Collaboration Digest",
    "",
    `Generated: ${input.generatedAt}`,
    `Owner: ${input.owner}`,
    `Reviewer: ${input.reviewer}`,
    "",
    "## Pending Approvals",
    "",
    listItemsOrNone(
      input.pendingApprovals.map(
        (approval) =>
          `${approval.id}: ${approval.risk} ${approval.reason} requested_by=${approval.requestedBy} expires=${approval.expiresAt ?? "none"}`
      )
    ),
    "",
    "## Risk Acceptances",
    "",
    listItemsOrNone(
      input.riskAcceptances.map(
        (acceptance) =>
          `${acceptance.evidenceId}: ${acceptance.decision} owner=${acceptance.owner} gate=${acceptance.gate} expires=${acceptance.expiresAt ?? "none"} reason=${acceptance.reason}`
      )
    ),
    "",
    "## Expiry Reminders",
    "",
    listItemsOrNone(input.expiryReminders),
    "",
    "## Notifications",
    "",
    listItemsOrNone(input.notifications),
    "",
    "## Role Views",
    "",
    listItemsOrNone(
      Object.entries(input.roleViews).map(([role, summary]) => `${role}: ${summary}`)
    ),
    "",
    "## Export Contract",
    "",
    listItemsOrNone([
      "Share this markdown with founders, engineers, ops, and security reviewers before launch.",
      "Attach team-collaboration.json to customer, investor, or internal launch reviews when auditability is required."
    ]),
    ""
  ].join("\n");
}

function listItemsOrNone(items: string[]): string {
  return items.length === 0 ? "- none" : items.map((item) => `- ${item}`).join("\n");
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
