import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import type { Evidence, JsonObject, RunsteadEvent, Task } from "@runstead/core";

export interface RuntimeStorageIdentity {
  backend: "sqlite" | "postgres" | "memory" | "custom";
  stateUri: string;
  rootUri?: string;
  artifactBaseUri?: string;
}

export interface RuntimeHomeLayout {
  rootPath: string;
  rootUri: string;
  stateUri: string;
  artifactBaseUri: string;
  logBaseUri: string;
  lockUri: string;
}

export interface RuntimeEventAppend {
  event: RunsteadEvent;
  projection?: RuntimeProjectionMutation;
  expectedRevision?: number;
  idempotencyKey?: string;
}

export type RuntimeProjectionMutation =
  | {
      type: "task";
      value: Task;
    }
  | {
      type: "evidence";
      value: Evidence;
    }
  | {
      type: "custom";
      aggregateType: string;
      aggregateId: string;
      value: JsonObject;
    };

export interface RuntimeEventAppendResult {
  eventId: string;
  aggregateType: string;
  aggregateId: string;
  revision?: number;
}

export interface RuntimeEventQuery {
  type?: string;
  aggregateType?: string;
  aggregateId?: string;
  afterRevision?: number;
  limit?: number;
}

export interface RuntimeEventStore {
  append(entries: RuntimeEventAppend[]): Promise<RuntimeEventAppendResult[]>;
  read(query?: RuntimeEventQuery): Promise<RunsteadEvent[]>;
}

export interface RuntimeLockRequest {
  resource: string;
  owner: string;
  ttlMs: number;
  now?: Date;
}

export interface RuntimeLockLease {
  resource: string;
  owner: string;
  token: string;
  expiresAt: string;
  release(): Promise<void>;
  renew(ttlMs: number): Promise<RuntimeLockLease>;
}

export interface RuntimeLockManager {
  acquire(request: RuntimeLockRequest): Promise<RuntimeLockLease>;
}

export interface RuntimeArtifactWrite {
  path: string;
  contentType: string;
  contents: string | Uint8Array;
  metadata?: JsonObject;
}

export interface RuntimeArtifactRecord {
  uri: string;
  contentType: string;
  sha256?: string;
  metadata?: JsonObject;
}

export interface RuntimeArtifactStore {
  write(artifact: RuntimeArtifactWrite): Promise<RuntimeArtifactRecord>;
  read(uri: string): Promise<Uint8Array>;
}

export interface RuntimeControlPlaneBackend {
  identity: RuntimeStorageIdentity;
  events: RuntimeEventStore;
  locks: RuntimeLockManager;
  artifacts: RuntimeArtifactStore;
}

export function createLocalRuntimeHomeLayout(rootPath: string): RuntimeHomeLayout {
  const root = resolve(rootPath);

  return {
    rootPath: root,
    rootUri: pathToFileURL(root).href,
    stateUri: pathToFileURL(join(root, "state.db")).href,
    artifactBaseUri: pathToFileURL(join(root, "evidence")).href,
    logBaseUri: pathToFileURL(join(root, "logs")).href,
    lockUri: pathToFileURL(join(root, "manager.lock")).href
  };
}

export function createLocalSqliteStorageIdentity(
  layout: RuntimeHomeLayout
): RuntimeStorageIdentity {
  return {
    backend: "sqlite",
    rootUri: layout.rootUri,
    stateUri: layout.stateUri,
    artifactBaseUri: layout.artifactBaseUri
  };
}
