import type { openRunsteadDatabase } from "@runstead/state-sqlite";

export interface DomainPackUsage {
  activeGoals: number;
  activeTasks: number;
}

export function readDomainPackUsage(
  database: ReturnType<typeof openRunsteadDatabase>,
  domainId: string
): DomainPackUsage {
  const activeGoals = database
    .prepare(
      `
      SELECT COUNT(*) AS count
      FROM goals
      WHERE domain = ?
        AND status IN ('active', 'paused')
    `
    )
    .get(domainId) as { count: number };
  const activeTasks = database
    .prepare(
      `
      SELECT COUNT(*) AS count
      FROM tasks
      WHERE domain = ?
        AND status IN ('queued', 'claimed', 'running', 'waiting_approval', 'blocked')
    `
    )
    .get(domainId) as { count: number };

  return {
    activeGoals: activeGoals.count,
    activeTasks: activeTasks.count
  };
}
