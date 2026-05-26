import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { LaunchSecurityRiskScan } from "./startup-automation-types.js";
import {
  collectRepoFileIndex,
  scanForSecretFindings
} from "./startup-security-file-scan.js";
const THIRD_PARTY_INTEGRATION_PACKAGES = [
  "stripe",
  "@stripe/stripe-js",
  "@sentry/browser",
  "@sentry/node",
  "@sentry/nextjs",
  "posthog-js",
  "mixpanel-browser",
  "firebase",
  "@supabase/supabase-js",
  "@paddle/paddle-js",
  "datadog-metrics"
];

export async function collectLaunchSecurityRiskScan(
  cwd: string,
  dependencyFiles: string[]
): Promise<LaunchSecurityRiskScan> {
  const [files, packageManifest] = await Promise.all([
    collectRepoFileIndex(cwd),
    readPackageManifest(cwd)
  ]);

  return {
    secretFindings: await scanForSecretFindings(cwd, files),
    licenseFindings: packageLicenseFindings(packageManifest),
    dependencyFindings: dependencyRiskFindings({
      files,
      dependencyFiles,
      packageManifest
    }),
    backupRestoreFindings: backupRestoreRiskFindings(files),
    authAndPrivacyFindings: authAndPrivacyRiskFindings({
      files,
      packageManifest
    }),
    prodConfigFindings: productionConfigRiskFindings(files),
    thirdPartyFindings: thirdPartyIntegrationRiskFindings({
      files,
      packageManifest
    })
  };
}

async function readPackageManifest(
  cwd: string
): Promise<Record<string, unknown> | null> {
  try {
    const parsed = JSON.parse(
      await readFile(join(cwd, "package.json"), "utf8")
    ) as unknown;

    return isObjectRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function packageLicenseFindings(
  packageManifest: Record<string, unknown> | null
): string[] {
  if (packageManifest === null) {
    return ["package.json is missing; license posture is unknown"];
  }

  if (
    packageManifest.private !== true &&
    typeof packageManifest.license !== "string" &&
    !Array.isArray(packageManifest.licenses)
  ) {
    return ["package license is not declared for a launchable artifact"];
  }

  return [];
}

function dependencyRiskFindings(input: {
  files: string[];
  dependencyFiles: string[];
  packageManifest: Record<string, unknown> | null;
}): string[] {
  const findings: string[] = [];

  if (
    input.packageManifest !== null &&
    !input.dependencyFiles.some((file) => file !== "package.json")
  ) {
    findings.push("dependency lockfile is missing for reproducible launch builds");
  }

  if (
    input.dependencyFiles.length > 0 &&
    !hasAnyFile(input.files, [
      "audit",
      "osv",
      "dependabot",
      "dependency-review",
      ".snyk"
    ])
  ) {
    findings.push(
      "dependency vulnerability evidence is missing (npm audit, osv-scanner, Dependabot, or connector evidence)"
    );
  }

  return findings;
}

function backupRestoreRiskFindings(files: string[]): string[] {
  return hasAnyFile(files, ["backup", "restore", "rollback"])
    ? []
    : ["backup, restore, or rollback drill evidence is missing"];
}

function authAndPrivacyRiskFindings(input: {
  files: string[];
  packageManifest: Record<string, unknown> | null;
}): string[] {
  const findings: string[] = [];

  if (!hasAnyFile(input.files, ["privacy", "retention", "pii"])) {
    findings.push("privacy, PII, or data retention notes are missing");
  }

  const dependencies = packageDependencyNames(input.packageManifest);
  const authSignals = dependencies.some((name) =>
    [
      "next-auth",
      "@auth/core",
      "@auth0/auth0-react",
      "firebase",
      "@supabase/supabase-js"
    ].includes(name)
  );

  if (authSignals && !hasAnyFile(input.files, ["auth", "session", "security"])) {
    findings.push(
      "auth/session review evidence is missing for detected auth dependencies"
    );
  }

  return findings;
}

function productionConfigRiskFindings(files: string[]): string[] {
  const findings: string[] = [];

  if (!hasAnyFile(files, [".env.example", "env.example", "environment", "config"])) {
    findings.push("environment variable inventory is missing");
  }

  if (!hasAnyFile(files, ["security-header", "headers", "csp", "prod", "production"])) {
    findings.push("production config drift and security header evidence is missing");
  }

  return findings;
}

function thirdPartyIntegrationRiskFindings(input: {
  files: string[];
  packageManifest: Record<string, unknown> | null;
}): string[] {
  const dependencies = packageDependencyNames(input.packageManifest);
  const integrations = THIRD_PARTY_INTEGRATION_PACKAGES.filter((name) =>
    dependencies.includes(name)
  );

  if (
    integrations.length === 0 ||
    hasAnyFile(input.files, ["integration", "runbook"])
  ) {
    return [];
  }

  return [
    `third-party integration failure-mode evidence is missing: ${integrations.join(", ")}`
  ];
}

function packageDependencyNames(
  packageManifest: Record<string, unknown> | null
): string[] {
  if (packageManifest === null) {
    return [];
  }

  const names = new Set<string>();

  for (const key of [
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies"
  ]) {
    const value = packageManifest[key];

    if (!isObjectRecord(value)) {
      continue;
    }

    for (const name of Object.keys(value)) {
      names.add(name);
    }
  }

  return [...names].sort((left, right) => left.localeCompare(right));
}

function hasAnyFile(files: string[], needles: string[]): boolean {
  const loweredNeedles = needles.map((needle) => needle.toLowerCase());

  return files.some((file) => {
    const loweredFile = file.toLowerCase();

    return loweredNeedles.some((needle) => loweredFile.includes(needle));
  });
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
