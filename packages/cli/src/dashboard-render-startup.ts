import type { DashboardStartupSnapshot } from "./dashboard-types.js";
import { escapeHtml, statusCell } from "./dashboard-render-html.js";
import { startupOverviewTable } from "./dashboard-render-startup-overview.js";
import { startupRunDetailTables } from "./dashboard-render-startup-run-tables.js";
import {
  startupRunComparisonTable,
  startupTimelineGroupsTable
} from "./dashboard-render-startup-tables.js";

export function startupSection(startup: DashboardStartupSnapshot): string {
  if (!startup.available || startup.status === undefined) {
    return `<section><header><h2>Startup Readiness</h2><span class="muted">unavailable</span></header><div class="empty">${escapeHtml(startup.error ?? "Startup status is not available.")}</div></section>`;
  }

  const status = startup.status;
  const gateRows = status.gates
    .map(
      (gate) =>
        `<tr><td>${escapeHtml(gate.stage)}</td><td>${statusCell(gate.status)}</td><td>${gate.blockers.length}</td><td>${escapeHtml(gate.blockers[0] ?? "none")}</td></tr>`
    )
    .join("");
  const blockerRows = status.gates.flatMap((gate) =>
    gate.blockers.map(
      (blocker) =>
        `<tr><td>${escapeHtml(gate.stage)}</td><td>${escapeHtml(blocker)}</td></tr>`
    )
  );
  const staleRows = startup.staleEvidence
    .map(
      (item) =>
        `<tr><td><code>${escapeHtml(item.evidenceId)}</code></td><td>${escapeHtml(item.type)}</td><td>${item.ageDays}d / ${item.freshnessDays}d</td><td>${escapeHtml(item.uri)}</td></tr>`
    )
    .join("");

  return `<section>
    <header><h2>Startup Readiness</h2><span class="muted">${escapeHtml(status.currentStage)}</span></header>
    ${startupOverviewTable(startup)}
    ${startupRunComparisonTable(startup.runComparison)}
    ${startupTimelineGroupsTable(startup.timelineGroups)}
    ${startupRunDetailTables(startup)}
    <table>
      <thead><tr><th>Gate</th><th>Status</th><th>Blockers</th><th>Top blocker</th></tr></thead>
      <tbody>${gateRows}</tbody>
    </table>
    ${
      blockerRows.length === 0
        ? '<div class="empty">No startup blockers.</div>'
        : `<table><thead><tr><th>Gate</th><th>Blocker board</th></tr></thead><tbody>${blockerRows.join("")}</tbody></table>`
    }
    ${
      startup.staleEvidence.length === 0
        ? '<div class="empty">No stale startup evidence sources.</div>'
        : `<table><thead><tr><th>Evidence</th><th>Type</th><th>Age</th><th>Source</th></tr></thead><tbody>${staleRows}</tbody></table>`
    }
  </section>`;
}
