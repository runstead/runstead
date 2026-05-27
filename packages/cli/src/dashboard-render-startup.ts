import type { DashboardStartupSnapshot } from "./dashboard-types.js";
import { escapeHtml } from "./dashboard-render-html.js";
import { startupGateAndEvidenceTables } from "./dashboard-render-startup-gates.js";
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

  return `<section>
    <header><h2>Startup Readiness</h2><span class="muted">${escapeHtml(status.currentStage)}</span></header>
    ${startupOverviewTable(startup)}
    ${startupRunComparisonTable(startup.runComparison)}
    ${startupTimelineGroupsTable(startup.timelineGroups)}
    ${startupRunDetailTables(startup)}
    ${startupGateAndEvidenceTables(startup)}
  </section>`;
}
