import type { DashboardStartupSnapshot } from "./dashboard-types.js";
import { escapeHtml, statusCell } from "./dashboard-render-html.js";

export function startupGateAndEvidenceTables(
  startup: DashboardStartupSnapshot
): string {
  return [
    startupGateSummaryTable(startup),
    startupBlockerBoard(startup),
    startupStaleEvidenceTable(startup)
  ].join("");
}

function startupGateSummaryTable(startup: DashboardStartupSnapshot): string {
  const status = startup.status;

  if (status === undefined) {
    return "";
  }

  const rows = status.gates
    .map(
      (gate) =>
        `<tr><td>${escapeHtml(gate.stage)}</td><td>${statusCell(gate.status)}</td><td>${gate.blockers.length}</td><td>${escapeHtml(gate.blockers[0] ?? "none")}</td></tr>`
    )
    .join("");

  return `<table>
      <thead><tr><th>Gate</th><th>Status</th><th>Blockers</th><th>Top blocker</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function startupBlockerBoard(startup: DashboardStartupSnapshot): string {
  const status = startup.status;

  if (status === undefined) {
    return "";
  }

  const rows = status.gates.flatMap((gate) =>
    gate.blockers.map(
      (blocker) =>
        `<tr><td>${escapeHtml(gate.stage)}</td><td>${escapeHtml(blocker)}</td></tr>`
    )
  );

  return rows.length === 0
    ? '<div class="empty">No startup blockers.</div>'
    : `<table><thead><tr><th>Gate</th><th>Blocker board</th></tr></thead><tbody>${rows.join("")}</tbody></table>`;
}

function startupStaleEvidenceTable(startup: DashboardStartupSnapshot): string {
  if (startup.staleEvidence.length === 0) {
    return '<div class="empty">No stale startup evidence sources.</div>';
  }

  const rows = startup.staleEvidence
    .map(
      (item) =>
        `<tr><td><code>${escapeHtml(item.evidenceId)}</code></td><td>${escapeHtml(item.type)}</td><td>${item.ageDays}d / ${item.freshnessDays}d</td><td>${escapeHtml(item.uri)}</td></tr>`
    )
    .join("");

  return `<table><thead><tr><th>Evidence</th><th>Type</th><th>Age</th><th>Source</th></tr></thead><tbody>${rows}</tbody></table>`;
}
