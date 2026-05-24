import { randomUUID } from "node:crypto";

import type { Task } from "@runstead/core";
import type { RuntimeControlPlaneBackend } from "@runstead/runtime";

export interface RuntimeControlPlaneConformanceContext {
  backend: RuntimeControlPlaneBackend;
  inspect?: RuntimeControlPlaneBackendInspector;
  cleanup?: () => Promise<void>;
}

export interface RuntimeControlPlaneBackendInspector {
  eventCount?: (aggregateType: string, aggregateId: string) => Promise<number>;
  projectionCount?: (projectionType: string, aggregateId: string) => Promise<number>;
}

export interface RuntimeControlPlaneConformanceOptions {
  name: string;
  create: () => Promise<RuntimeControlPlaneConformanceContext>;
}

export interface RuntimeControlPlaneConformanceResult {
  name: string;
  checks: string[];
}

export async function runRuntimeControlPlaneBackendConformance(
  options: RuntimeControlPlaneConformanceOptions
): Promise<RuntimeControlPlaneConformanceResult> {
  const context = await options.create();
  const checks: string[] = [];

  try {
    await checkAtomicEventProjection(context);
    checks.push("event_append_projection");

    await checkIdempotency(context);
    checks.push("idempotency_key");

    await checkRevisionConflict(context);
    checks.push("expected_revision_conflict");

    await checkLockLifecycle(context);
    checks.push("lock_renew_release");

    await checkArtifacts(context);
    checks.push("artifact_hash_read");

    return {
      name: options.name,
      checks
    };
  } finally {
    await context.cleanup?.();
  }
}

async function checkAtomicEventProjection(
  context: RuntimeControlPlaneConformanceContext
): Promise<void> {
  const task = conformanceTask();
  const [result] = await context.backend.events.append([
    {
      event: {
        eventId: `evt_${task.id}`,
        type: "task.created",
        aggregateType: "task",
        aggregateId: task.id,
        payload: {
          id: task.id,
          status: task.status
        },
        createdAt: task.createdAt
      },
      expectedRevision: 0,
      projection: {
        type: "task",
        value: task
      }
    }
  ]);
  const events = await context.backend.events.read({
    aggregateType: "task",
    aggregateId: task.id
  });

  if (result?.revision !== 1) {
    throw new Error("backend did not return revision 1 for initial append");
  }

  if (events.length !== 1 || events[0]?.eventId !== `evt_${task.id}`) {
    throw new Error("backend did not read back the appended event");
  }

  if (context.inspect?.projectionCount !== undefined) {
    const count = await context.inspect.projectionCount("task", task.id);

    if (count !== 1) {
      throw new Error("backend did not atomically persist the task projection");
    }
  }
}

async function checkIdempotency(
  context: RuntimeControlPlaneConformanceContext
): Promise<void> {
  const task = conformanceTask();
  const entry = {
    event: {
      eventId: `evt_${task.id}`,
      type: "task.updated",
      aggregateType: "task",
      aggregateId: task.id,
      payload: {
        id: task.id,
        status: task.status
      },
      createdAt: task.createdAt
    },
    expectedRevision: 0,
    idempotencyKey: `${task.id}:update`
  };
  const [first] = await context.backend.events.append([entry]);
  const [second] = await context.backend.events.append([entry]);

  if (JSON.stringify(first) !== JSON.stringify(second)) {
    throw new Error("backend idempotency key returned a different append result");
  }

  if (context.inspect?.eventCount !== undefined) {
    const count = await context.inspect.eventCount("task", task.id);

    if (count !== 1) {
      throw new Error("backend idempotency key appended duplicate events");
    }
  }
}

async function checkRevisionConflict(
  context: RuntimeControlPlaneConformanceContext
): Promise<void> {
  const task = conformanceTask();

  await context.backend.events.append([
    {
      event: {
        eventId: `evt_${task.id}_1`,
        type: "task.updated",
        aggregateType: "task",
        aggregateId: task.id,
        payload: {},
        createdAt: task.createdAt
      },
      expectedRevision: 0
    }
  ]);

  try {
    await context.backend.events.append([
      {
        event: {
          eventId: `evt_${task.id}_2`,
          type: "task.updated",
          aggregateType: "task",
          aggregateId: task.id,
          payload: {},
          createdAt: task.createdAt
        },
        expectedRevision: 0
      }
    ]);
  } catch {
    return;
  }

  throw new Error("backend accepted an append with a stale expected revision");
}

async function checkLockLifecycle(
  context: RuntimeControlPlaneConformanceContext
): Promise<void> {
  const resource = `workspace:${randomUUID()}`;
  const lease = await context.backend.locks.acquire({
    resource,
    owner: "runner:one",
    ttlMs: 30_000,
    now: new Date("2026-05-24T00:00:00.000Z")
  });

  if (lease.resource !== resource || lease.token.length === 0) {
    throw new Error("backend returned an invalid initial lock lease");
  }

  try {
    await context.backend.locks.acquire({
      resource,
      owner: "runner:two",
      ttlMs: 30_000,
      now: new Date("2026-05-24T00:00:01.000Z")
    });
  } catch {
    const renewed = await lease.renew(45_000);

    if (renewed.token !== lease.token) {
      throw new Error("backend renew returned a different lease token");
    }

    await renewed.release();

    const nextLease = await context.backend.locks.acquire({
      resource,
      owner: "runner:two",
      ttlMs: 30_000,
      now: new Date("2026-05-24T00:00:02.000Z")
    });

    if (nextLease.owner !== "runner:two" || nextLease.token === lease.token) {
      throw new Error("backend did not release and reacquire the lock");
    }

    if (
      lease.fencingToken !== undefined &&
      nextLease.fencingToken !== undefined &&
      Number(nextLease.fencingToken) <= Number(lease.fencingToken)
    ) {
      throw new Error("backend fencing token did not increase on reacquire");
    }

    await nextLease.release();
    return;
  }

  throw new Error("backend allowed a competing lock owner before expiry");
}

async function checkArtifacts(
  context: RuntimeControlPlaneConformanceContext
): Promise<void> {
  const artifact = await context.backend.artifacts.write({
    path: `conformance/${randomUUID()}.txt`,
    contentType: "text/plain",
    contents: "runstead control plane",
    metadata: {
      suite: "control-plane-conformance"
    }
  });
  const contents = await context.backend.artifacts.read(artifact.uri);

  if (!/^sha256:[a-f0-9]{64}$/u.test(artifact.sha256 ?? "")) {
    throw new Error("backend artifact write did not return a sha256 hash");
  }

  if (Buffer.from(contents).toString("utf8") !== "runstead control plane") {
    throw new Error("backend artifact read did not return original contents");
  }
}

function conformanceTask(): Task {
  const id = `task_${randomUUID().replace(/-/gu, "_")}`;

  return {
    id,
    goalId: `goal_${id}`,
    domain: "repo-maintenance",
    type: "local_agent_task",
    status: "queued",
    priority: "medium",
    attempt: 0,
    maxAttempts: 1,
    input: {},
    verifiers: [],
    createdAt: "2026-05-24T00:00:00.000Z",
    updatedAt: "2026-05-24T00:00:00.000Z"
  };
}
