import { constants } from "node:fs";
import { access, copyFile, mkdir, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { getRepoMaintenancePackDir } from "@runstead/domain-packs";
import { openRunsteadDatabase } from "@runstead/state-sqlite";

import { storeRepoInspectionEvidence } from "./inspection-evidence.js";

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
  - id: allow_verifier_commands
    when:
      action_type: shell.exec
      command:
        matches_any:
          - "^pnpm test( .*)?$"
          - "^pnpm run lint( .*)?$"
          - "^npm test( .*)?$"
          - "^npm run lint( .*)?$"
          - "^yarn test( .*)?$"
          - "^yarn lint( .*)?$"
          - "^bun test( .*)?$"
          - "^bun run lint( .*)?$"
    decision: allow
    risk: low
    obligations:
      - capture_output
      - attach_as_evidence
      - redact_secrets

  - id: deny_secret_files
    when:
      path:
        matches_any:
          - ".env"
          - ".env.*"
          - "**/secrets/**"
          - "infra/prod/**"
    decision: deny
    risk: critical

  - id: require_approval_external_write
    when:
      side_effects:
        contains_any:
          - network_write_external
          - send_message_external
          - git_push
          - github_pr_create
    decision: require_approval
    risk: high
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

  await copyDirectoryIfMissing(
    getRepoMaintenancePackDir(),
    join(root, "domains", "repo-maintenance"),
    options.force
  );
  await writeIfMissing(join(root, "config.yaml"), DEFAULT_CONFIG, options.force);
  await writeIfMissing(join(root, "events.jsonl"), "", options.force);
  await writeIfMissing(
    join(root, "policies", "repo-maintenance.yaml"),
    DEFAULT_POLICY,
    options.force
  );

  const database = openRunsteadDatabase(stateDb);

  try {
    await storeRepoInspectionEvidence({
      cwd,
      runsteadRoot: root,
      database
    });
  } finally {
    database.close();
  }

  return {
    root,
    domain: "repo-maintenance",
    stateDb
  };
}

async function copyDirectoryIfMissing(
  source: string,
  destination: string,
  force = false
): Promise<void> {
  await mkdir(destination, { recursive: true });

  const entries = await readdir(source, { withFileTypes: true });

  await Promise.all(
    entries.map(async (entry) => {
      const sourcePath = join(source, entry.name);
      const destinationPath = join(destination, entry.name);

      if (entry.isDirectory()) {
        await copyDirectoryIfMissing(sourcePath, destinationPath, force);
        return;
      }

      if (!entry.isFile()) {
        return;
      }

      await copyFileIfMissing(sourcePath, destinationPath, force);
    })
  );
}

async function copyFileIfMissing(
  source: string,
  destination: string,
  force = false
): Promise<void> {
  try {
    await copyFile(source, destination, force ? 0 : constants.COPYFILE_EXCL);
  } catch (error) {
    if (!force && isAlreadyExistsError(error)) {
      return;
    }

    throw error;
  }
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

function isAlreadyExistsError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "EEXIST"
  );
}
