import type {
  StartupCollaborationApproval,
  StartupRiskAcceptance
} from "./startup-collaboration-types.js";

export function formatStartupCollaborationDigest(input: {
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
