const EXECUTION_LEASE_MS = 30 * 60 * 1000;

export function executionLeaseOwnerId(): string {
  return `pid:${process.pid}`;
}

export function executionLeaseExpiresAt(heartbeatAt: string): string {
  const parsed = Date.parse(heartbeatAt);
  const heartbeatMs = Number.isNaN(parsed) ? Date.now() : parsed;

  return new Date(heartbeatMs + EXECUTION_LEASE_MS).toISOString();
}
