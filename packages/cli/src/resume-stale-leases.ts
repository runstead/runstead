import { openRunsteadDatabase } from "@runstead/state-sqlite";

export const DEFAULT_STALE_LEASE_FALLBACK_MS = 30 * 60 * 1000;

export function staleInterruptedTaskIds(input: {
  stateDb: string;
  now: Date;
  staleAfterMs: number;
}): Set<string> {
  const database = openRunsteadDatabase(input.stateDb);
  const nowIso = input.now.toISOString();
  const fallbackCutoff = new Date(
    input.now.getTime() - input.staleAfterMs
  ).toISOString();

  try {
    const rows = database
      .prepare(
        `
        SELECT id, owner_id, lease_expires_at, updated_at
        FROM tasks
        WHERE status IN ('claimed', 'running')
          AND (
            (lease_expires_at IS NOT NULL AND lease_expires_at <= ?)
            OR (lease_expires_at IS NULL AND updated_at <= ?)
          )
        ORDER BY updated_at ASC, id ASC
      `
      )
      .all(nowIso, fallbackCutoff) as unknown as StaleTaskLeaseRow[];

    return new Set(
      rows.filter((row) => !leaseOwnerAlive(row.owner_id)).map((row) => row.id)
    );
  } finally {
    database.close();
  }
}

interface StaleTaskLeaseRow {
  id: string;
  owner_id: string | null;
  lease_expires_at: string | null;
  updated_at: string;
}

function leaseOwnerAlive(ownerId: string | null): boolean {
  if (ownerId === null) {
    return false;
  }

  const match = /^pid:(\d+)$/.exec(ownerId);

  if (match === null) {
    return false;
  }

  const pid = Number.parseInt(match[1] ?? "", 10);

  if (!Number.isSafeInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return isPermissionDeniedSignalError(error);
  }
}

function isPermissionDeniedSignalError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "EPERM"
  );
}
