import type { DashboardDaemonStatus } from "./dashboard-types.js";
import { escapeHtml } from "./dashboard-render-html.js";

export function daemonSection(status: DashboardDaemonStatus): string {
  const rows: [string, string][] = status.available
    ? [
        ["Status", "available"],
        ...(status.stale === undefined
          ? []
          : ([
              [
                "Health",
                `${status.stale ? "stale" : "healthy"}${
                  status.ageMs === undefined ? "" : ` age=${status.ageMs}ms`
                }`
              ]
            ] as [string, string][])),
        ["Updated", status.updatedAt ?? "unknown"],
        ["Tick", status.tick === undefined ? "unknown" : String(status.tick)],
        [
          "Last result",
          status.ranTask === true
            ? `${status.taskId ?? "unknown"} ${status.taskStatus ?? "unknown"}`
            : `idle (${status.reason ?? "unknown"})`
        ],
        ...(status.ciRepairStatus === undefined
          ? []
          : ([
              [
                "CI repair",
                [
                  status.ciRepairStatus,
                  status.branchName === undefined
                    ? undefined
                    : `branch=${status.branchName}`,
                  status.pullRequest === undefined
                    ? undefined
                    : `pr=${status.pullRequest}`,
                  status.approvalId === undefined
                    ? undefined
                    : `approval=${status.approvalId}`
                ]
                  .filter((part): part is string => part !== undefined)
                  .join(" ")
              ]
            ] as [string, string][])),
        ...(status.eventId === undefined
          ? []
          : ([["Audit event", status.eventId]] as [string, string][]))
      ]
    : [
        ["Status", "unavailable"],
        ["Reason", status.error ?? "missing_status"]
      ];
  const body = rows
    .map(
      ([label, value]) =>
        `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`
    )
    .join("");

  return `<section><header><h2>Daemon</h2><span class="muted">${daemonSectionLabel(status)}</span></header><table><tbody>${body}</tbody></table></section>`;
}

function daemonSectionLabel(status: DashboardDaemonStatus): string {
  if (!status.available) {
    return "offline";
  }

  return status.stale === true ? "stale" : "heartbeat";
}
