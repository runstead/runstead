import type { DashboardStartupSnapshot } from "./dashboard-types.js";
import { escapeHtml, statusCell } from "./dashboard-render-html.js";

export function startupRunDetailTables(startup: DashboardStartupSnapshot): string {
  return [
    startupRunTimelineTable(startup),
    startupOperatorCommandsTable(startup),
    startupGuidedFlowTable(startup)
  ].join("");
}

function startupRunTimelineTable(startup: DashboardStartupSnapshot): string {
  const run = startup.latestRun;

  if (run === undefined) {
    return '<div class="empty">No startup readiness run has been recorded.</div>';
  }

  const rows = run.timeline
    .map(
      (item) =>
        `<tr><td>${escapeHtml(item.title)}</td><td>${statusCell(item.status)}</td><td>${item.evidence}</td><td>${escapeHtml(item.blockers[0] ?? item.nextAction ?? "none")}</td></tr>`
    )
    .join("");

  return `<table>
      <thead><tr><th>Timeline</th><th>Status</th><th>Evidence</th><th>Top blocker or next action</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function startupOperatorCommandsTable(startup: DashboardStartupSnapshot): string {
  const run = startup.latestRun;

  if (run === undefined || run.operatorCommands.length === 0) {
    return '<div class="empty">No startup operator commands.</div>';
  }

  const rows = run.operatorCommands
    .map(
      (item) =>
        `<tr><td>${escapeHtml(item.title)}</td><td><code>${escapeHtml(item.command)}</code></td><td>${escapeHtml(item.when)}</td></tr>`
    )
    .join("");

  return `<table>
      <thead><tr><th>Operator command</th><th>Command</th><th>When</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function startupGuidedFlowTable(startup: DashboardStartupSnapshot): string {
  const run = startup.latestRun;

  if (run === undefined || run.guidedFlow.length === 0) {
    return '<div class="empty">No guided next steps.</div>';
  }

  const rows = run.guidedFlow
    .map(
      (step) =>
        `<tr><td>${escapeHtml(step.title)}</td><td>${statusCell(step.status)}</td><td>${escapeHtml(step.resolution)}</td><td>${escapeHtml(step.nextAction)}${
          step.command === undefined
            ? ""
            : `<br><code>${escapeHtml(step.command)}</code>`
        }</td></tr>`
    )
    .join("");

  return `<table>
      <thead><tr><th>Guided next step</th><th>Status</th><th>Owner</th><th>Action</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}
