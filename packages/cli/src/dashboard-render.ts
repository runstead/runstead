import type { DashboardSnapshot } from "./dashboard-types.js";
import { DASHBOARD_OPERATOR_SCRIPT } from "./dashboard-render-operator-script.js";
import { DASHBOARD_RENDER_STYLES } from "./dashboard-render-styles.js";
import { dashboardCoreTables } from "./dashboard-render-core-tables.js";
import { escapeHtml, metric } from "./dashboard-render-html.js";
import { daemonSection } from "./dashboard-render-daemon.js";
import { operatorConsoleSection } from "./dashboard-render-operator.js";
import { startupSection } from "./dashboard-render-startup.js";

export function formatDashboardHtml(snapshot: DashboardSnapshot): string {
  const summary = snapshot.summary;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Runstead Dashboard</title>
  <style>${DASHBOARD_RENDER_STYLES}</style>
  <script>${DASHBOARD_OPERATOR_SCRIPT}</script>
</head>
<body>
  <header>
    <h1>Runstead Dashboard</h1>
    <div class="muted">Generated ${escapeHtml(snapshot.generatedAt)}</div>
  </header>
  <main>
    <div class="summary">
      ${metric("Repositories", summary.repositories)}
      ${metric("Active Goals", summary.activeGoals)}
      ${metric("Queued Tasks", summary.queuedTasks)}
      ${metric("Running Tasks", summary.runningTasks)}
      ${metric("Failed Tasks", summary.failedTasks)}
      ${metric("Pending Approvals", summary.pendingApprovals)}
    </div>
    ${operatorConsoleSection(snapshot.operator)}
    ${startupSection(snapshot.startup)}
    ${daemonSection(snapshot.daemon)}
    ${dashboardCoreTables(snapshot)}
  </main>
</body>
</html>
`;
}
