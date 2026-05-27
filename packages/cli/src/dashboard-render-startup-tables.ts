import type {
  DashboardStartupRunComparison,
  DashboardStartupTimelineGroup
} from "./dashboard-types.js";
import { escapeHtml, statusCell } from "./dashboard-render-html.js";

export function startupRunComparisonTable(
  comparison: DashboardStartupRunComparison | undefined
): string {
  if (comparison === undefined) {
    return '<div class="empty">Run comparison unavailable.</div>';
  }

  const completed = comparison.latestCompleted;
  const blocked = comparison.latestBlocked;
  const resolutionRows =
    comparison.resolvedBlockerDetails.length === 0
      ? "none"
      : comparison.resolvedBlockerDetails
          .map(
            (detail) =>
              `<strong>${escapeHtml(detail.blocker)}</strong><br>${escapeHtml(detail.resolution)}<br>phases: ${escapeHtml(detail.phases.join(", ") || "none")}<br>evidence: ${escapeHtml(detail.evidenceIds.join(", ") || "none")}<br>${detail.artifacts.map((artifact) => `<code>${escapeHtml(artifact)}</code>`).join("<br>") || "artifacts: none"}`
          )
          .join("<hr>");

  return `<table>
    <thead><tr><th>Run comparison</th><th>Run</th><th>Verdict</th><th>Blockers</th></tr></thead>
    <tbody>
      <tr><td>Latest completed</td><td>${
        completed === undefined
          ? "none"
          : `<code>${escapeHtml(completed.id)}</code> ${statusCell(completed.status)}`
      }</td><td>${escapeHtml(completed?.verdict ?? "none")}</td><td>${completed?.blockerCount ?? 0}</td></tr>
      <tr><td>Latest blocked/interrupted</td><td>${
        blocked === undefined
          ? "none"
          : `<code>${escapeHtml(blocked.id)}</code> ${statusCell(blocked.status)}`
      }</td><td>${escapeHtml(blocked?.verdict ?? "none")}</td><td>${blocked?.blockerCount ?? 0}</td></tr>
      <tr><td>Resolved blockers</td><td colspan="3">${comparison.resolvedBlockers.length === 0 ? "none" : comparison.resolvedBlockers.map(escapeHtml).join("<br>")}</td></tr>
      <tr><td>Resolution evidence</td><td colspan="3">${resolutionRows}</td></tr>
      <tr><td>Still shared</td><td colspan="3">${comparison.stillBlocked.length === 0 ? "none" : comparison.stillBlocked.map(escapeHtml).join("<br>")}</td></tr>
      <tr><td>Summary</td><td colspan="3">${escapeHtml(comparison.narrative)}</td></tr>
    </tbody>
  </table>`;
}

export function startupTimelineGroupsTable(
  groups: DashboardStartupTimelineGroup[]
): string {
  if (groups.length === 0) {
    return '<div class="empty">No startup operator timeline entries.</div>';
  }

  return groups
    .map((group) => {
      const rows = group.items
        .slice(0, 10)
        .map((item) => {
          const artifacts =
            item.artifacts.length === 0
              ? "none"
              : item.artifacts
                  .map((artifact) => `<code>${escapeHtml(artifact)}</code>`)
                  .join("<br>");

          return `<tr><td><code>${escapeHtml(item.id)}</code><br>${escapeHtml(item.title)}</td><td>${statusCell(item.status)}</td><td>${escapeHtml(item.createdAt ?? "n/a")}</td><td>${escapeHtml(item.detail ?? "none")}<br>${artifacts}</td></tr>`;
        })
        .join("");

      return `<table>
        <thead><tr><th>Timeline: ${escapeHtml(group.title)}</th><th>Status</th><th>Time</th><th>Detail</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
    })
    .join("");
}
