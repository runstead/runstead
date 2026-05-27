import type { DashboardStartupSnapshot } from "./dashboard-types.js";
import { escapeHtml, statusCell } from "./dashboard-render-html.js";

export function startupOverviewTable(startup: DashboardStartupSnapshot): string {
  const status = startup.status;

  if (status === undefined) {
    return "";
  }

  const run = startup.latestRun;
  const sources = status.evidence.sourceKinds.join(", ") || "none";
  const uiArtifacts = run?.uiSmokeArtifacts ?? [];
  const agentPatch = startup.agentPatch;

  return `<table><tbody>
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
    </tbody></table>`;
}
