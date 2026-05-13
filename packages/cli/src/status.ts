import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";

import { openRunsteadDatabase } from "@runstead/state-sqlite";

import { resolveRunsteadRoot } from "./runstead-root.js";

export interface RunsteadStatusGoal {
  id: string;
  title: string;
  status: string;
  priority: string;
}

export interface RunsteadStatusTasks {
  total: number;
  byStatus: Record<string, number>;
}

export interface RunsteadStatusEvidence {
  id: string;
  type: string;
  summary?: string;
  createdAt: string;
}

export interface RunsteadStatus {
  initialized: boolean;
  root: string;
  domain?: string;
  goals?: RunsteadStatusGoal[];
  tasks?: RunsteadStatusTasks;
  latestEvidence?: RunsteadStatusEvidence;
}

export async function getRunsteadStatus(cwd = process.cwd()): Promise<RunsteadStatus> {
  const resolvedRoot = await resolveRunsteadRoot(cwd);
  const root = resolvedRoot.root;
  const configPath = join(root, "config.yaml");

  if (resolvedRoot.source === "missing") {
    return {
      initialized: false,
      root
    };
  }

  await access(configPath, constants.R_OK);

  const config = await readFile(configPath, "utf8");
  const domain = /^domain:\s*(?<domain>[^\n]+)$/m.exec(config)?.groups?.domain;
  const state = readStateStatus(join(root, "state.db"));

  const status: RunsteadStatus = {
    initialized: true,
    root,
    goals: state.goals,
    tasks: state.tasks
  };

  if (domain !== undefined) {
    status.domain = domain;
  }

  if (state.latestEvidence !== undefined) {
    status.latestEvidence = state.latestEvidence;
  }

  return status;
}

function readStateStatus(path: string): {
  goals: RunsteadStatusGoal[];
  tasks: RunsteadStatusTasks;
  latestEvidence?: RunsteadStatusEvidence;
} {
  const database = openRunsteadDatabase(path);

  try {
    const goals = database
      .prepare(
        `
        SELECT id, title, status, priority
        FROM goals
        ORDER BY created_at DESC, id ASC
      `
      )
      .all() as unknown as RunsteadStatusGoal[];
    const taskRows = database
      .prepare(
        `
        SELECT status, COUNT(*) AS count
        FROM tasks
        GROUP BY status
        ORDER BY status ASC
      `
      )
      .all() as unknown as { status: string; count: number }[];
    const latestEvidence = database
      .prepare(
        `
        SELECT id, type, summary, created_at
        FROM evidence
        ORDER BY created_at DESC, id DESC
        LIMIT 1
      `
      )
      .get() as
      | {
          id: string;
          type: string;
          summary: string | null;
          created_at: string;
        }
      | undefined;
    const tasksByStatus: Record<string, number> = {};

    for (const row of taskRows) {
      tasksByStatus[row.status] = row.count;
    }

    return {
      goals,
      tasks: {
        total: taskRows.reduce((total, row) => total + row.count, 0),
        byStatus: tasksByStatus
      },
      ...(latestEvidence === undefined
        ? {}
        : {
            latestEvidence: {
              id: latestEvidence.id,
              type: latestEvidence.type,
              ...(latestEvidence.summary === null
                ? {}
                : { summary: latestEvidence.summary }),
              createdAt: latestEvidence.created_at
            }
          })
    };
  } finally {
    database.close();
  }
}
