import { constants } from "node:fs";
import { access, copyFile, mkdir, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import type { Goal, Task } from "@runstead/core";
import {
  buildDomainPackManifest,
  getRepoMaintenancePackDir
} from "@runstead/domain-packs";
import { openRunsteadDatabase } from "@runstead/state-sqlite";

import { createGoal } from "./goals.js";
import { storeRepoInspectionEvidence } from "./inspection-evidence.js";
import { DEFAULT_RBAC_YAML } from "./rbac.js";
import { DEFAULT_TEAM_POLICY_YAML } from "./team-policy.js";

export interface InitRunsteadOptions {
  cwd?: string;
  force?: boolean;
  createDefaultGoal?: boolean;
}

export interface InitRunsteadResult {
  root: string;
  domain: "repo-maintenance";
  stateDb: string;
  defaultGoal?: Goal;
  generatedTasks: Task[];
}

const DEFAULT_CONFIG = `version: 1
domain: repo-maintenance

state:
  sqlite: state.db

events:
  source: sqlite

verifiers:
  test: null
  lint: null

workers:
  default: shell
`;

const DEFAULT_POLICY = `id: policy_repo_maintenance_v1
version: 1
default_decision: require_approval
default_risk: medium

rules:
  - id: allow_read_workspace
    when:
      action_type:
        in:
          - filesystem.read
          - git.status
          - git.diff
          - github.run.read
          - github.run.log.read
    decision: allow
    risk: low

  - id: allow_ci_repair_workspace_actions
    when:
      action_type:
        in:
          - git.branch.create
          - checkpoint.create
          - checkpoint.restore
          - worker.external.start
    decision: allow
    risk: medium
    obligations:
      - capture_output
      - attach_as_evidence
      - verify_diff_scope

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

  - id: deny_destructive_shell
    when:
      action_type: shell.exec
      command:
        matches_any:
          - ".*rm -rf.*"
          - ".*sudo .*"
          - ".*mkfs.*"
          - ".*dd if=.*"
    decision: deny
    risk: critical

  - id: require_approval_dependency_change
    when:
      action_type:
        in:
          - package.install
          - package.update
      path:
        matches_any:
          - package.json
          - package-lock.json
          - pnpm-lock.yaml
          - requirements.txt
          - poetry.lock
    decision: require_approval
    risk: high

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
  await mkdir(join(root, "daemon"), { recursive: true });
  await mkdir(join(root, "reports"), { recursive: true });

  const repoMaintenanceDomainDir = join(root, "domains", "repo-maintenance");

  await copyDirectoryIfMissing(
    getRepoMaintenancePackDir(),
    repoMaintenanceDomainDir,
    options.force
  );
  await writeDomainPackManifest(repoMaintenanceDomainDir);
  await writeIfMissing(join(root, "config.yaml"), DEFAULT_CONFIG, options.force);
  await writeIfMissing(
    join(root, "policies", "repo-maintenance.yaml"),
    DEFAULT_POLICY,
    options.force
  );
  await writeIfMissing(join(root, "rbac.yaml"), DEFAULT_RBAC_YAML, options.force);
  await writeIfMissing(
    join(root, "team-policy.yaml"),
    DEFAULT_TEAM_POLICY_YAML,
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

  const createdGoal = options.createDefaultGoal
    ? await createGoal({
        cwd,
        domain: "repo-maintenance"
      })
    : undefined;

  return {
    root,
    domain: "repo-maintenance",
    stateDb,
    ...(createdGoal === undefined ? {} : { defaultGoal: createdGoal.goal }),
    generatedTasks: createdGoal?.generatedTasks ?? []
  };
}

async function writeDomainPackManifest(packDir: string): Promise<void> {
  const manifest = await buildDomainPackManifest(packDir);

  await writeFile(
    join(packDir, "runstead-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8"
  );
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
