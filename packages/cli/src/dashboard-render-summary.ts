import type { DashboardSummary } from "./dashboard-types.js";
import { metric } from "./dashboard-render-html.js";

export function dashboardSummaryMetrics(summary: DashboardSummary): string {
  return `<div class="summary">
      ${metric("Repositories", summary.repositories)}
      ${metric("Active Goals", summary.activeGoals)}
      ${metric("Queued Tasks", summary.queuedTasks)}
      ${metric("Running Tasks", summary.runningTasks)}
      ${metric("Failed Tasks", summary.failedTasks)}
      ${metric("Pending Approvals", summary.pendingApprovals)}
    </div>`;
}
