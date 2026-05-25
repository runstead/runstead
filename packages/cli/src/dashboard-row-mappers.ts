import type {
  DashboardApproval,
  DashboardEvent,
  DashboardGoal,
  DashboardRepository,
  DashboardTask
} from "./dashboard-types.js";

export interface RepositoryRow {
  id: string;
  alias: string;
  local_path: string;
  remote_url: string | null;
  status: string;
}

export interface GoalRow {
  id: string;
  domain: string;
  title: string;
  status: string;
  priority: string;
  scope_json: string;
  updated_at: string;
}

export interface TaskRow {
  id: string;
  goal_id: string;
  type: string;
  status: string;
  priority: string;
  updated_at: string;
}

export interface ApprovalRow {
  id: string;
  action_id: string;
  status: string;
  risk: string;
  reason: string;
  updated_at: string;
}

export interface EventRow {
  event_id: string;
  type: string;
  aggregate_type: string;
  aggregate_id: string;
  created_at: string;
}

export function rowToRepository(row: RepositoryRow): DashboardRepository {
  return {
    id: row.id,
    alias: row.alias,
    localPath: row.local_path,
    status: row.status,
    ...(row.remote_url === null ? {} : { remoteUrl: row.remote_url })
  };
}

export function rowToGoal(row: GoalRow): DashboardGoal {
  const scope = JSON.parse(row.scope_json) as { repositoryAlias?: unknown };
  const repositoryAlias =
    typeof scope.repositoryAlias === "string" ? scope.repositoryAlias : undefined;

  return {
    id: row.id,
    title: row.title,
    domain: row.domain,
    status: row.status,
    priority: row.priority,
    ...(repositoryAlias === undefined ? {} : { repositoryAlias }),
    updatedAt: row.updated_at
  };
}

export function rowToTask(row: TaskRow): DashboardTask {
  return {
    id: row.id,
    goalId: row.goal_id,
    type: row.type,
    status: row.status,
    priority: row.priority,
    updatedAt: row.updated_at
  };
}

export function rowToApproval(row: ApprovalRow): DashboardApproval {
  return {
    id: row.id,
    actionId: row.action_id,
    status: row.status,
    risk: row.risk,
    reason: row.reason,
    updatedAt: row.updated_at
  };
}

export function rowToEvent(row: EventRow): DashboardEvent {
  return {
    eventId: row.event_id,
    type: row.type,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    createdAt: row.created_at
  };
}
