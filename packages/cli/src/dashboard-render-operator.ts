import type { DashboardOperatorConsole } from "./dashboard-types.js";
import { escapeHtml, statusCell } from "./dashboard-render-html.js";

export function operatorConsoleSection(operator: DashboardOperatorConsole): string {
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
