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
import {
  installGitInfoExclude,
  writeRunsteadRuntimeIgnoreFile
} from "./init-runtime-ignore.js";
import { storeRepoInspectionEvidence } from "./inspection-evidence.js";
import { DEFAULT_RBAC_YAML } from "./rbac.js";
import { DEFAULT_TEAM_POLICY_YAML } from "./team-policy.js";
import {
  policyYamlForProfile,
  resolveInitPolicyProfile,
  type InitPolicyProfile
} from "./init-policy.js";

export type { InitPolicyProfile } from "./init-policy.js";

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
  await writeRunsteadRuntimeIgnoreFile(root, options.force);
  await installGitInfoExclude(cwd);
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
