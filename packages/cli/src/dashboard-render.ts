import type {
  DashboardDaemonStatus,
  DashboardOperatorConsole,
  DashboardSnapshot,
  DashboardStartupRunComparison,
  DashboardStartupSnapshot,
  DashboardStartupTimelineGroup
} from "./dashboard-types.js";
import {
  DASHBOARD_OPERATOR_SCRIPT,
  DASHBOARD_RENDER_STYLES
} from "./dashboard-render-assets.js";

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
    ${tableSection(
      "Repositories",
      snapshot.repositories,
      ["Alias", "Status", "Path"],
      (item) => [
        `<code>${escapeHtml(item.alias)}</code>`,
        statusCell(item.status),
        escapeHtml(item.localPath)
      ]
    )}
    ${tableSection(
      "Goals",
      snapshot.goals,
      ["Title", "Status", "Repository", "Updated"],
      (item) => [
        escapeHtml(item.title),
        statusCell(item.status),
        escapeHtml(item.repositoryAlias ?? "local"),
        escapeHtml(item.updatedAt)
      ]
    )}
    ${tableSection(
      "Tasks",
      snapshot.tasks,
      ["Type", "Status", "Priority", "Updated"],
      (item) => [
        `<code>${escapeHtml(item.type)}</code>`,
        statusCell(item.status),
        escapeHtml(item.priority),
        escapeHtml(item.updatedAt)
      ]
    )}
    ${tableSection(
      "Approvals",
      snapshot.approvals,
      ["Action", "Status", "Risk", "Reason"],
      (item) => [
        `<code>${escapeHtml(item.actionId)}</code>`,
        statusCell(item.status),
        riskCell(item.risk),
        escapeHtml(item.reason)
      ]
    )}
    ${tableSection(
      "Recent Events",
      snapshot.events,
      ["Type", "Aggregate", "Created"],
      (item) => [
        `<code>${escapeHtml(item.type)}</code>`,
        `${escapeHtml(item.aggregateType)}/${escapeHtml(item.aggregateId)}`,
        escapeHtml(item.createdAt)
      ]
    )}
  </main>
</body>
</html>
`;
}

function metric(label: string, value: number): string {
  return `<div class="metric"><strong>${value}</strong><span>${escapeHtml(label)}</span></div>`;
}

function operatorConsoleSection(operator: DashboardOperatorConsole): string {
  const recommended =
    operator.recommendedAction === undefined
      ? "none"
      : `${operator.recommendedAction.title}: ${operator.recommendedAction.reason}`;
  const run = operator.currentRun;
  const pendingApprovals =
    operator.pendingApprovals.length === 0
      ? "none"
      : operator.pendingApprovals
          .map(
            (approval) =>
              `<code>${escapeHtml(approval.id)}</code> ${escapeHtml(approval.risk)}
              <button type="button" class="primary" data-approval-id="${escapeHtml(approval.id)}" data-approval-decision="approve" onclick="decideOperatorApproval(this)">Approve</button>
              <button type="button" data-approval-id="${escapeHtml(approval.id)}" data-approval-decision="deny" onclick="decideOperatorApproval(this)">Deny</button>
              <br><code>${escapeHtml(approval.command)}</code>`
          )
          .join("<br>");

  if (operator.actions.length === 0) {
    return `<section><header><h2>Operator Console</h2><span class="muted">0 actions</span></header>${operatorConsoleContextTable(operator, pendingApprovals)}<div class="empty">No operator actions are available.</div>${operatorApiPanel()}</section>`;
  }

  const rows = operator.actions
    .map(
      (action) => `<div class="operator-action">
        <div><strong>${escapeHtml(action.title)}</strong><br><span class="muted">${escapeHtml(action.source)} · ${statusCell(action.status)}</span></div>
        <div><code>${escapeHtml(action.command)}</code><br><span class="muted">${escapeHtml(action.reason)}</span></div>
        <button type="button" data-command="${escapeHtml(action.command)}" onclick="copyOperatorCommand(this)">Copy</button>
        <button type="button" class="primary" data-operator-action-id="${escapeHtml(action.id)}" onclick="runOperatorAction(this)">Run</button>
      </div>`
    )
    .join("");

  return `<section>
    <header><h2>Operator Console</h2><span class="muted">${operator.actions.length} action${operator.actions.length === 1 ? "" : "s"}</span></header>
    <table><tbody>
      <tr><th>Current run</th><td>${
        run === undefined
          ? "none"
          : `<code>${escapeHtml(run.id)}</code> ${statusCell(run.status)} target=${escapeHtml(run.target)} verdict=${escapeHtml(run.verdict)}<br><code>${escapeHtml(run.resumeCommand ?? "")}</code>`
      }</td></tr>
      <tr><th>Recommended</th><td>${escapeHtml(recommended)}</td></tr>
      <tr><th>Recommended command</th><td><code>${escapeHtml(operator.recommendedCommand ?? "none")}</code></td></tr>
      <tr><th>Blockers</th><td>${operator.blockerCount}</td></tr>
      <tr><th>Pending approvals</th><td>${pendingApprovals}</td></tr>
      <tr><th>Stale evidence</th><td>${operator.staleEvidenceCount}</td></tr>
      <tr><th>API</th><td><code>/operator-actions.json</code></td></tr>
    </tbody></table>
    <div class="operator-actions">${rows}</div>
    ${operatorApiPanel()}
  </section>`;
}

function operatorApiPanel(): string {
  return `<div class="operator-api">
    <label><span class="muted">Session token</span><input type="password" autocomplete="off" data-operator-session></label>
    <label><span class="muted">CSRF token</span><input type="password" autocomplete="off" data-operator-csrf></label>
    <label><span class="muted">Verifier task</span><input type="text" autocomplete="off" data-verifier-task-id></label>
    <label><span class="muted">Verifier mode</span><select data-verifier-mode><option value="evidence_only">evidence_only</option><option value="finalize_task">finalize_task</option></select></label>
    <button type="button" class="primary" onclick="runVerifiersForm(this)">Run verifiers</button>
    <label><span class="muted">Evidence type</span><input type="text" value="manual_change" autocomplete="off" data-manual-evidence-type></label>
    <label><span class="muted">Gate</span><select data-manual-evidence-gate><option value="">none</option><option value="idea">idea</option><option value="mvp">mvp</option><option value="launch">launch</option><option value="scale">scale</option></select></label>
    <label><span class="muted">Summary</span><input type="text" autocomplete="off" data-manual-evidence-summary></label>
    <label><span class="muted">Source refs</span><textarea data-manual-evidence-source-refs></textarea></label>
    <label><span class="muted">Content</span><textarea data-manual-evidence-content></textarea></label>
    <button type="button" class="primary" onclick="recordManualEvidenceForm(this)">Record evidence</button>
    <div class="operator-result" data-operator-result></div>
  </div>`;
}

function operatorConsoleContextTable(
  operator: DashboardOperatorConsole,
  pendingApprovals: string
): string {
  const run = operator.currentRun;

  return `<table><tbody>
    <tr><th>Current run</th><td>${
      run === undefined
        ? "none"
        : `<code>${escapeHtml(run.id)}</code> ${statusCell(run.status)} target=${escapeHtml(run.target)} verdict=${escapeHtml(run.verdict)}<br><code>${escapeHtml(run.resumeCommand ?? "")}</code>`
    }</td></tr>
    <tr><th>Recommended command</th><td><code>${escapeHtml(operator.recommendedCommand ?? "none")}</code></td></tr>
    <tr><th>Blockers</th><td>${operator.blockerCount}</td></tr>
    <tr><th>Pending approvals</th><td>${pendingApprovals}</td></tr>
    <tr><th>Stale evidence</th><td>${operator.staleEvidenceCount}</td></tr>
    <tr><th>API</th><td><code>/operator-actions.json</code></td></tr>
  </tbody></table>`;
}

function startupSection(startup: DashboardStartupSnapshot): string {
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

function daemonSection(status: DashboardDaemonStatus): string {
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

function tableSection<T>(
  title: string,
  rows: T[],
  columns: string[],
  mapRow: (row: T) => string[]
): string {
  const body =
    rows.length === 0
      ? `<div class="empty">No ${escapeHtml(title.toLowerCase())}.</div>`
      : `<table>
        <thead><tr>${columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("")}</tr></thead>
        <tbody>
          ${rows
            .map(
              (row) =>
                `<tr>${mapRow(row)
                  .map((cell) => `<td>${cell}</td>`)
                  .join("")}</tr>`
            )
            .join("\n")}
        </tbody>
      </table>`;

  return `<section><header><h2>${escapeHtml(title)}</h2><span class="muted">${rows.length}</span></header>${body}</section>`;
}

function statusCell(status: string): string {
  return `<span class="status-${escapeHtml(status)}">${escapeHtml(status)}</span>`;
}

function riskCell(risk: string): string {
  return `<span class="risk-${escapeHtml(risk)}">${escapeHtml(risk)}</span>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
