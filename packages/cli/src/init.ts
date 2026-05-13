import { constants } from "node:fs";
import { access, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { repoMaintenanceDomainYaml } from "@runstead/domain-packs";
import { openRunsteadDatabase } from "@runstead/state-sqlite";

export interface InitRunsteadOptions {
  cwd?: string;
  force?: boolean;
}

export interface InitRunsteadResult {
  root: string;
  domain: "repo-maintenance";
  stateDb: string;
}

const DEFAULT_CONFIG = `version: 1
domain: repo-maintenance

state:
  sqlite: state.db

events:
  mirror: events.jsonl

verifiers:
  test: null
  lint: null

workers:
  default: shell
`;

const DEFAULT_POLICY = `id: policy_repo_maintenance_v1
version: 1

rules:
  - id: deny_secret_files
    when:
      path:
        matches_any:
          - ".env"
          - ".env.*"
          - "**/secrets/**"
    decision: deny
    risk: critical
`;

export async function initRunstead(
  options: InitRunsteadOptions = {}
): Promise<InitRunsteadResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const root = join(cwd, ".runstead");
  const stateDb = join(root, "state.db");

  await mkdir(join(root, "domains", "repo-maintenance"), { recursive: true });
  await mkdir(join(root, "policies"), { recursive: true });
  await mkdir(join(root, "evidence"), { recursive: true });
  await mkdir(join(root, "logs", "worker-runs"), { recursive: true });
  await mkdir(join(root, "logs", "tool-calls"), { recursive: true });
  await mkdir(join(root, "logs", "verifiers"), { recursive: true });
  await mkdir(join(root, "checkpoints"), { recursive: true });
  await mkdir(join(root, "reports"), { recursive: true });

  await writeIfMissing(join(root, "config.yaml"), DEFAULT_CONFIG, options.force);
  await writeIfMissing(join(root, "events.jsonl"), "", options.force);
  await writeIfMissing(
    join(root, "domains", "repo-maintenance", "domain.yaml"),
    repoMaintenanceDomainYaml,
    options.force
  );
  await writeIfMissing(
    join(root, "policies", "repo-maintenance.yaml"),
    DEFAULT_POLICY,
    options.force
  );

  const database = openRunsteadDatabase(stateDb);
  database.close();

  return {
    root,
    domain: "repo-maintenance",
    stateDb
  };
}

async function writeIfMissing(
  path: string,
  contents: string,
  force = false
): Promise<void> {
  if (!force && (await exists(path))) {
    return;
  }

  await writeFile(path, contents, "utf8");
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}
