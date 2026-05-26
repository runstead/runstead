import type {
  DashboardStartupRunComparison,
  DashboardStartupSnapshot,
  DashboardStartupTimelineGroup
} from "./dashboard-types.js";
import { escapeHtml, statusCell } from "./dashboard-render-html.js";

export function startupSection(startup: DashboardStartupSnapshot): string {
  if (!startup.available || startup.status === undefined) {
    return `<section><header><h2>Startup Readiness</h2><span class="muted">unavailable</span></header><div class="empty">${escapeHtml(startup.error ?? "Startup status is not available.")}</div></section>`;
  }

  const status = startup.status;
  const run = startup.latestRun;
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
  const sources = status.evidence.sourceKinds.join(", ") || "none";
  const timelineRows =
    run === undefined
      ? ""
      : run.timeline
          .map(
            (item) =>
              `<tr><td>${escapeHtml(item.title)}</td><td>${statusCell(item.status)}</td><td>${item.evidence}</td><td>${escapeHtml(item.blockers[0] ?? item.nextAction ?? "none")}</td></tr>`
          )
          .join("");
  const staleRows = startup.staleEvidence
    .map(
      (item) =>
        `<tr><td><code>${escapeHtml(item.evidenceId)}</code></td><td>${escapeHtml(item.type)}</td><td>${item.ageDays}d / ${item.freshnessDays}d</td><td>${escapeHtml(item.uri)}</td></tr>`
    )
    .join("");
  const uiArtifacts = run?.uiSmokeArtifacts ?? [];
  const guidedRows =
    run === undefined
      ? ""
      : run.guidedFlow
          .map(
            (step) =>
              `<tr><td>${escapeHtml(step.title)}</td><td>${statusCell(step.status)}</td><td>${escapeHtml(step.resolution)}</td><td>${escapeHtml(step.nextAction)}${
                step.command === undefined
                  ? ""
                  : `<br><code>${escapeHtml(step.command)}</code>`
              }</td></tr>`
          )
          .join("");
  const operatorCommandRows =
    run === undefined
      ? ""
      : run.operatorCommands
          .map(
            (item) =>
              `<tr><td>${escapeHtml(item.title)}</td><td><code>${escapeHtml(item.command)}</code></td><td>${escapeHtml(item.when)}</td></tr>`
          )
          .join("");
  const agentPatch = startup.agentPatch;

  return `<section>
    <header><h2>Startup Readiness</h2><span class="muted">${escapeHtml(status.currentStage)}</span></header>
    <table><tbody>
      <tr><th>Latest run</th><td>${
        run === undefined
          ? "none"
          : `<code>${escapeHtml(run.id)}</code> ${statusCell(run.status)} verdict=${escapeHtml(run.verdict)} target=${escapeHtml(run.target)}`
      }</td></tr>
      <tr><th>Next action</th><td><code>${escapeHtml(status.nextAction.command)}</code><br>${escapeHtml(status.nextAction.reason)}</td></tr>
      <tr><th>Evidence</th><td>${status.evidence.total} records; sources: ${escapeHtml(sources)}; stale: ${status.evidence.staleSources.length}</td></tr>
      <tr><th>Latest report</th><td><code>${escapeHtml(startup.latestReportPath ?? "none")}</code></td></tr>
      <tr><th>UI smoke artifacts</th><td>${uiArtifacts.length === 0 ? "none" : uiArtifacts.map((artifact) => `<code>${escapeHtml(artifact)}</code>`).join("<br>")}</td></tr>
      <tr><th>Agent patch</th><td>${
        agentPatch === undefined
          ? "none"
          : `${statusCell(agentPatch.status)} task=<code>${escapeHtml(agentPatch.taskId)}</code><br>${escapeHtml(agentPatch.summary)}${
              agentPatch.filesTouched.length === 0
                ? ""
                : `<br>${agentPatch.filesTouched.map((file) => `<code>${escapeHtml(file)}</code>`).join("<br>")}`
            }`
      }</td></tr>
    </tbody></table>
    ${startupRunComparisonTable(startup.runComparison)}
    ${startupTimelineGroupsTable(startup.timelineGroups)}
    ${
      run === undefined
        ? '<div class="empty">No startup readiness run has been recorded.</div>'
        : `<table>
      <thead><tr><th>Timeline</th><th>Status</th><th>Evidence</th><th>Top blocker or next action</th></tr></thead>
      <tbody>${timelineRows}</tbody>
    </table>`
    }
    ${
      run === undefined || run.operatorCommands.length === 0
        ? '<div class="empty">No startup operator commands.</div>'
        : `<table>
      <thead><tr><th>Operator command</th><th>Command</th><th>When</th></tr></thead>
      <tbody>${operatorCommandRows}</tbody>
    </table>`
    }
    ${
      run === undefined || run.guidedFlow.length === 0
        ? '<div class="empty">No guided next steps.</div>'
        : `<table>
      <thead><tr><th>Guided next step</th><th>Status</th><th>Owner</th><th>Action</th></tr></thead>
      <tbody>${guidedRows}</tbody>
    </table>`
    }
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

function startupRunComparisonTable(
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

function startupTimelineGroupsTable(groups: DashboardStartupTimelineGroup[]): string {
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
