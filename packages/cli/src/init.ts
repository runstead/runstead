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

export type InitPolicyProfile = "default" | "trusted-local";

export interface InitRunsteadOptions {
  cwd?: string;
  force?: boolean;
  createDefaultGoal?: boolean;
  profile?: InitPolicyProfile;
}

export interface InitRunsteadResult {
  root: string;
  domain: "repo-maintenance";
  profile: InitPolicyProfile;
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

const DEFAULT_POLICY = repoMaintenancePolicyYaml("default");
const TRUSTED_LOCAL_POLICY = repoMaintenancePolicyYaml("trusted-local");
const INIT_POLICY_PROFILES: InitPolicyProfile[] = ["default", "trusted-local"];

function repoMaintenancePolicyYaml(profile: InitPolicyProfile): string {
  return `id: policy_repo_maintenance_v1
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
          - git.commit
          - checkpoint.create
          - checkpoint.restore
    decision: allow
    risk: medium
    obligations:
      - capture_output
      - attach_as_evidence
      - verify_diff_scope

${externalWorkerStartPolicyRuleYaml(profile)}

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
          - yarn.lock
          - bun.lockb
          - requirements.txt
          - poetry.lock
          - uv.lock
          - go.mod
          - go.sum
          - Cargo.toml
          - Cargo.lock
    decision: require_approval
    risk: high

  - id: require_approval_dependency_file_commit
    when:
      action_type: git.commit
      path:
        matches_any:
          - package.json
          - package-lock.json
          - pnpm-lock.yaml
          - yarn.lock
          - bun.lockb
          - requirements.txt
          - poetry.lock
          - uv.lock
          - go.mod
          - go.sum
          - Cargo.toml
          - Cargo.lock
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
}

function externalWorkerStartPolicyRuleYaml(profile: InitPolicyProfile): string {
  if (profile === "trusted-local") {
    return `  - id: allow_trusted_local_external_worker_start
    when:
      action_type: worker.external.start
      resource_id:
        in:
          - codex_cli
          - claude_code
    decision: allow
    risk: medium`;
  }

  return `  - id: require_approval_external_worker_start
    when:
      action_type: worker.external.start
    decision: require_approval
    risk: high`;
}

export async function initRunstead(
  options: InitRunsteadOptions = {}
): Promise<InitRunsteadResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const root = join(cwd, ".runstead");
  const stateDb = join(root, "state.db");
  const profile = resolveInitPolicyProfile(options.profile);

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
  await writeDomainPackManifest(repoMaintenanceDomainDir, options.force);
  await writeIfMissing(join(root, "config.yaml"), DEFAULT_CONFIG, options.force);
  await writeIfMissing(
    join(root, "policies", "repo-maintenance.yaml"),
    policyYamlForProfile(profile),
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
    profile,
    stateDb,
    ...(createdGoal === undefined ? {} : { defaultGoal: createdGoal.goal }),
    generatedTasks: createdGoal?.generatedTasks ?? []
  };
}

function policyYamlForProfile(profile: InitPolicyProfile): string {
  return profile === "trusted-local" ? TRUSTED_LOCAL_POLICY : DEFAULT_POLICY;
}

function resolveInitPolicyProfile(
  profile: InitPolicyProfile | undefined
): InitPolicyProfile {
  if (profile === undefined) {
    return "default";
  }

  if (INIT_POLICY_PROFILES.includes(profile)) {
    return profile;
  }

  throw new Error(`Unsupported init profile: ${profile}`);
}

async function writeDomainPackManifest(packDir: string, force = false): Promise<void> {
  const manifestPath = join(packDir, "runstead-manifest.json");

  if (!force && (await exists(manifestPath))) {
    return;
  }

  const manifest = await buildDomainPackManifest(packDir);

  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
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
