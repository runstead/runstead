# Runstead Team Control Plane Reference Stack

This example gives operators a local Postgres backend for exercising
Runstead's team control-plane path. It is a development reference, not a
production security boundary.

## Start Postgres

```bash
cd examples/team-control-plane
cp .env.example .env
docker compose --env-file .env up -d
```

## Apply The Runtime Schema

From the repository root:

```bash
set -a
. examples/team-control-plane/.env
set +a

runstead team control-plane check --cwd . --live --migrate
```

## Record Runner Liveness

```bash
set -a
. examples/team-control-plane/.env
set +a

runstead team control-plane runner heartbeat \
  --cwd . \
  --runner-id "$RUNSTEAD_RUNNER_ID" \
  --labels runstead,codex_direct \
  --migrate

runstead team control-plane runner list --cwd .
runstead team control-plane check --cwd . --live
```

The final check should prove the shared Postgres backend, runner registry,
fresh heartbeat, database leases, and backend identity. Production deployments
still need real artifact storage, external append-only audit, IdP/RBAC,
runner credentials, network isolation, and central secret management.
