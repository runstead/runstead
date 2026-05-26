import type {
  StartupCollaborationApproval,
  StartupRiskAcceptance
} from "./startup-collaboration-types.js";

export function collaborationExpiryReminders(input: {
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
