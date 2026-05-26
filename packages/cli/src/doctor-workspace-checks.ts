import { constants } from "node:fs";
import { access, readFile, readdir, stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

import {
  validateDomainPackDir,
  verifyDomainPackManifest
} from "@runstead/domain-packs";

import {
  errorMessage,
  fail,
  isRecord,
  pass,
  type DoctorCheck
} from "./doctor-types.js";
import { loadPolicyProfileFromFile } from "./policy-loader.js";

export async function checkRuntimeArtifactsIgnored(root: string): Promise<DoctorCheck> {
  const path = join(root, ".gitignore");
  const required = [
    "state.db",
    "state.db-*",
    "evidence/",
    "logs/",
    "checkpoints/",
    "daemon/",
    "reports/",
    "manager.lock"
  ];

  try {
    const lines = new Set((await readFile(path, "utf8")).split(/\r?\n/));
    const missing = required.filter((entry) => !lines.has(entry));

    return missing.length === 0
      ? pass("runtime-artifacts-ignore", "runtime artifacts ignore", path)
      : fail(
          "runtime-artifacts-ignore",
          "runtime artifacts ignore",
          `missing entries: ${missing.join(", ")}`
        );
  } catch (error) {
    return fail(
      "runtime-artifacts-ignore",
      "runtime artifacts ignore",
      errorMessage(error)
    );
  }
}

export async function checkReadableFile(
  id: string,
  label: string,
  path: string
): Promise<DoctorCheck> {
  try {
    await access(path, constants.R_OK);

    const pathStat = await stat(path);
    if (!pathStat.isFile()) {
      return fail(id, label, `${path} is not a file`);
    }

    return pass(id, label, path);
  } catch (error) {
    return fail(id, label, errorMessage(error));
  }
}

export async function checkDirectory(
  id: string,
  label: string,
  path: string
): Promise<DoctorCheck> {
  try {
    const pathStat = await stat(path);

    if (!pathStat.isDirectory()) {
      return fail(id, label, `${path} is not a directory`);
    }

    return pass(id, label, path);
  } catch (error) {
    return fail(id, label, errorMessage(error));
  }
}

export async function checkDomainPackValidation(path: string): Promise<DoctorCheck> {
  try {
    const result = await validateDomainPackDir(path);

    if (!result.valid) {
      return fail(
        "domain-pack-validation",
        "repo-maintenance domain pack validation",
        result.issues
          .filter((issue) => issue.severity === "error")
          .map((issue) => issue.code)
          .join(", ")
      );
    }

    return pass(
      "domain-pack-validation",
      "repo-maintenance domain pack validation",
      path
    );
  } catch (error) {
    return fail(
      "domain-pack-validation",
      "repo-maintenance domain pack validation",
      errorMessage(error)
    );
  }
}

export async function checkInstalledDomainPackManifests(
  root: string
): Promise<DoctorCheck> {
  const domainsRoot = join(root, "domains");

  try {
    const entries = await readdir(domainsRoot, { withFileTypes: true });
    const domainDirs = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => String(entry.name))
      .sort();

    if (domainDirs.length === 0) {
      return fail(
        "domain-pack-manifests",
        "installed domain pack manifests",
        "no installed domain packs"
      );
    }

    const failed: string[] = [];

    for (const id of domainDirs) {
      const result = await verifyDomainPackManifest(join(domainsRoot, id));

      if (!result.valid) {
        failed.push(`${id}: ${result.issues.map((issue) => issue.code).join(", ")}`);
      }
    }

    if (failed.length > 0) {
      return fail(
        "domain-pack-manifests",
        "installed domain pack manifests",
        failed.join("; ")
      );
    }

    return pass(
      "domain-pack-manifests",
      "installed domain pack manifests",
      `verified ${domainDirs.length} domain pack manifest(s)`
    );
  } catch (error) {
    return fail(
      "domain-pack-manifests",
      "installed domain pack manifests",
      errorMessage(error)
    );
  }
}

export async function checkDaemonHeartbeat(root: string): Promise<DoctorCheck> {
  const path = join(root, "daemon", "status.json");

  try {
    await access(path, constants.F_OK);
  } catch {
    return pass("daemon-heartbeat", "daemon heartbeat", "not recorded");
  }

  try {
    const value = JSON.parse(await readFile(path, "utf8")) as unknown;

    if (!isRecord(value)) {
      return fail("daemon-heartbeat", "daemon heartbeat", "status is not an object");
    }

    const cwd = value.cwd;
    const pid = value.pid;
    const tick = value.tick;
    const updatedAt = value.updatedAt;
    const ranTask = value.ranTask;
    const valid =
      typeof cwd === "string" &&
      typeof pid === "number" &&
      typeof tick === "number" &&
      typeof updatedAt === "string" &&
      typeof ranTask === "boolean";

    if (!valid) {
      return fail(
        "daemon-heartbeat",
        "daemon heartbeat",
        "status is missing required fields"
      );
    }

    return pass("daemon-heartbeat", "daemon heartbeat", `tick ${tick} at ${updatedAt}`);
  } catch (error) {
    return fail("daemon-heartbeat", "daemon heartbeat", errorMessage(error));
  }
}

export async function checkPolicyValidation(path: string): Promise<DoctorCheck> {
  try {
    await loadPolicyProfileFromFile(path);

    return pass("policy-validation", "repo-maintenance policy validation", path);
  } catch (error) {
    return fail(
      "policy-validation",
      "repo-maintenance policy validation",
      errorMessage(error)
    );
  }
}

export async function checkRbacPolicy(cwd: string): Promise<DoctorCheck> {
  try {
    const { loadRbacPolicy } = await import("./rbac.js");

    await loadRbacPolicy({ cwd });

    return pass("rbac-policy", "RBAC policy validation", "valid");
  } catch (error) {
    return fail("rbac-policy", "RBAC policy validation", errorMessage(error));
  }
}

export async function checkTeamPolicy(cwd: string): Promise<DoctorCheck> {
  try {
    const { compileTeamPolicyProfile, loadTeamPolicy } =
      await import("./team-policy.js");
    const policy = await loadTeamPolicy({ cwd });

    compileTeamPolicyProfile(policy);

    return pass("team-policy", "team policy validation", "valid");
  } catch (error) {
    return fail("team-policy", "team policy validation", errorMessage(error));
  }
}

export async function checkGitHubAppConfig(
  cwd: string,
  root: string
): Promise<DoctorCheck> {
  const path = join(root, "github-app.yaml");

  try {
    await access(path, constants.F_OK);
  } catch {
    return pass("github-app-config", "GitHub App config", "not configured");
  }

  try {
    const { loadGitHubAppConfig } = await import("./github-app.js");
    const config = await loadGitHubAppConfig({ cwd });
    const privateKeyPath = isAbsolute(config.privateKeyPath)
      ? config.privateKeyPath
      : join(root, config.privateKeyPath);

    await access(privateKeyPath, constants.R_OK);

    return pass("github-app-config", "GitHub App config", `app ${config.appId}`);
  } catch (error) {
    return fail("github-app-config", "GitHub App config", errorMessage(error));
  }
}
