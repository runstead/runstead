export interface ExportAuditLogOptions {
  cwd?: string;
  outputPath?: string;
  types?: string[];
  aggregateType?: string;
  aggregateId?: string;
}

export interface AuditLogEntry {
  id: number;
  eventId: string;
  type: string;
  aggregateType: string;
  aggregateId: string;
  payload: unknown;
  createdAt: string;
}

export interface ExportAuditLogResult {
  root: string;
  stateDb: string;
  entries: AuditLogEntry[];
  contents: string;
  outputPath?: string;
}

export interface ReplayAuditLifecycleOptions {
  cwd?: string;
  taskId: string;
}

export interface ReplayAuditLifecycleResult {
  root: string;
  stateDb: string;
  taskId: string;
  relatedIds: string[];
  entries: AuditLogEntry[];
}
