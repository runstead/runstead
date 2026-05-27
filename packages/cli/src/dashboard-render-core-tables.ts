import type { DashboardSnapshot } from "./dashboard-types.js";
import {
  escapeHtml,
  riskCell,
  statusCell,
  tableSection
} from "./dashboard-render-html.js";

export function dashboardCoreTables(snapshot: DashboardSnapshot): string {
  return [
    tableSection(
      "Repositories",
      snapshot.repositories,
      ["Alias", "Status", "Path"],
      (item) => [
        `<code>${escapeHtml(item.alias)}</code>`,
        statusCell(item.status),
        escapeHtml(item.localPath)
      ]
    ),
    tableSection(
      "Goals",
      snapshot.goals,
      ["Title", "Status", "Repository", "Updated"],
      (item) => [
        escapeHtml(item.title),
        statusCell(item.status),
        escapeHtml(item.repositoryAlias ?? "local"),
        escapeHtml(item.updatedAt)
      ]
    ),
    tableSection(
      "Tasks",
      snapshot.tasks,
      ["Type", "Status", "Priority", "Updated"],
      (item) => [
        `<code>${escapeHtml(item.type)}</code>`,
        statusCell(item.status),
        escapeHtml(item.priority),
        escapeHtml(item.updatedAt)
      ]
    ),
    tableSection(
      "Approvals",
      snapshot.approvals,
      ["Action", "Status", "Risk", "Reason"],
      (item) => [
        `<code>${escapeHtml(item.actionId)}</code>`,
        statusCell(item.status),
        riskCell(item.risk),
        escapeHtml(item.reason)
      ]
    ),
    tableSection(
      "Recent Events",
      snapshot.events,
      ["Type", "Aggregate", "Created"],
      (item) => [
        `<code>${escapeHtml(item.type)}</code>`,
        `${escapeHtml(item.aggregateType)}/${escapeHtml(item.aggregateId)}`,
        escapeHtml(item.createdAt)
      ]
    )
  ].join("");
}
