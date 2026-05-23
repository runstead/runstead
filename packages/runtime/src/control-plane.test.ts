import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import {
  createLocalRuntimeHomeLayout,
  createLocalSqliteStorageIdentity,
  type RuntimeControlPlaneBackend,
  type RuntimeEventAppend
} from "./index.js";

describe("@runstead/runtime control-plane contracts", () => {
  it("describes the local RUNSTEAD_HOME layout without binding callers to SQLite", () => {
    const layout = createLocalRuntimeHomeLayout("/workspace/repo/.runstead");

    expect(layout).toEqual({
      rootPath: "/workspace/repo/.runstead",
      rootUri: pathToFileURL("/workspace/repo/.runstead").href,
      stateUri: pathToFileURL("/workspace/repo/.runstead/state.db").href,
      artifactBaseUri: pathToFileURL("/workspace/repo/.runstead/evidence").href,
      logBaseUri: pathToFileURL("/workspace/repo/.runstead/logs").href,
      lockUri: pathToFileURL("/workspace/repo/.runstead/manager.lock").href
    });
    expect(createLocalSqliteStorageIdentity(layout)).toEqual({
      backend: "sqlite",
      rootUri: layout.rootUri,
      stateUri: layout.stateUri,
      artifactBaseUri: layout.artifactBaseUri
    });
  });

  it("lets backend implementations expose event, lock, and artifact boundaries", async () => {
    const layout = createLocalRuntimeHomeLayout(
      join("/workspace", "repo", ".runstead")
    );
    const appended: RuntimeEventAppend[] = [];
    const backend: RuntimeControlPlaneBackend = {
      identity: createLocalSqliteStorageIdentity(layout),
      events: {
        append: (entries) => {
          appended.push(...entries);

          return Promise.resolve(
            entries.map(({ event }, index) => ({
              eventId: event.eventId,
              aggregateType: event.aggregateType,
              aggregateId: event.aggregateId,
              revision: index + 1
            }))
          );
        },
        read: () => Promise.resolve(appended.map((entry) => entry.event))
      },
      locks: {
        acquire: (request) =>
          Promise.resolve({
            resource: request.resource,
            owner: request.owner,
            token: "lease_1",
            expiresAt: new Date(
              (request.now ?? new Date(0)).getTime() + request.ttlMs
            ).toISOString(),
            release: () => Promise.resolve(undefined),
            renew: (ttlMs) =>
              Promise.resolve({
                resource: request.resource,
                owner: request.owner,
                token: "lease_2",
                expiresAt: new Date(
                  (request.now ?? new Date(0)).getTime() + ttlMs
                ).toISOString(),
                release: () => Promise.resolve(undefined),
                renew: () =>
                  Promise.reject(new Error("test lease renewal stops here"))
              })
          })
      },
      artifacts: {
        write: (artifact) =>
          Promise.resolve({
            uri: `${layout.artifactBaseUri}/${artifact.path}`,
            contentType: artifact.contentType,
            ...(artifact.metadata === undefined
              ? {}
              : { metadata: artifact.metadata })
          }),
        read: () => Promise.resolve(new Uint8Array())
      }
    };

    const [result] = await backend.events.append([
      {
        event: {
          eventId: "evt_runtime_1",
          type: "task.updated",
          aggregateType: "task",
          aggregateId: "task_runtime_1",
          payload: {},
          createdAt: "2026-05-23T00:00:00.000Z"
        },
        expectedRevision: 0,
        idempotencyKey: "task_runtime_1:update"
      }
    ]);
    const lease = await backend.locks.acquire({
      resource: "workspace:/repo",
      owner: "worker:test",
      ttlMs: 30_000,
      now: new Date("2026-05-23T00:00:00.000Z")
    });
    const artifact = await backend.artifacts.write({
      path: "reports/example.json",
      contentType: "application/json",
      contents: "{}",
      metadata: {
        kind: "test"
      }
    });

    expect(result).toMatchObject({
      eventId: "evt_runtime_1",
      revision: 1
    });
    expect(lease.expiresAt).toBe("2026-05-23T00:00:30.000Z");
    expect(artifact).toMatchObject({
      uri: `${layout.artifactBaseUri}/reports/example.json`,
      contentType: "application/json",
      metadata: {
        kind: "test"
      }
    });
  });
});
