import { readFile, readdir } from "node:fs/promises";
import { extname, join, relative } from "node:path";

import type { LaunchSecurityRiskScan } from "./startup-automation-types.js";

const SECURITY_SCAN_SKIP_DIRS = new Set([
  ".git",
  ".runstead",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".turbo",
  ".next"
]);
const SECURITY_SCAN_SKIP_FILES = new Set([
  "pnpm-lock.yaml",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "bun.lock",
  "bun.lockb"
]);
const SECURITY_SCAN_EXTENSIONS = new Set([
  ".cjs",
  ".env",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mjs",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml"
]);
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

async function collectRepoFileIndex(cwd: string): Promise<string[]> {
  const files: string[] = [];

  async function visit(directory: string): Promise<void> {
    try {
      const entries = await readdir(directory, { withFileTypes: true });

      for (const entry of entries) {
        const absolutePath = join(directory, entry.name);
        const relativePath = normalizeRelativePath(relative(cwd, absolutePath));

        if (entry.isDirectory()) {
          if (!SECURITY_SCAN_SKIP_DIRS.has(entry.name)) {
            await visit(absolutePath);
          }

          continue;
        }

        if (!entry.isFile()) {
          continue;
        }

        files.push(relativePath);
      }
    } catch {
      return;
    }
  }

  await visit(cwd);

  return files.sort((left, right) => left.localeCompare(right));
}

async function scanForSecretFindings(cwd: string, files: string[]): Promise<string[]> {
  const findings: string[] = [];

  for (const file of files.filter(isSecurityScanCandidate)) {
    let content: string;

    try {
      content = await readFile(join(cwd, file), "utf8");
    } catch {
      continue;
    }

    const lines = content.split(/\r?\n/);

    for (const [index, line] of lines.entries()) {
      const kind = secretFindingKind(line);

      if (kind !== null) {
        findings.push(`${file}:${index + 1} ${kind}`);
      }
    }
  }

  return findings;
}

function secretFindingKind(line: string): string | null {
  if (/\bsk_live_[A-Za-z0-9_=-]{8,}\b/.test(line)) {
    return "stripe_live_secret_pattern";
  }

  if (/\bAKIA[0-9A-Z]{16}\b/.test(line)) {
    return "aws_access_key_pattern";
  }

  if (/-----BEGIN (?:RSA |DSA |EC |OPENSSH )?PRIVATE KEY-----/.test(line)) {
    return "private_key_pattern";
  }

  if (
    /\b(?:OPENAI|ANTHROPIC|GITHUB|SLACK|SENTRY|STRIPE)_[A-Z0-9_]*KEY\s*=\s*["']?[A-Za-z0-9_-]{20,}/i.test(
      line
    )
  ) {
    return "provider_api_key_assignment";
  }

  if (
    /\b(?:api[_-]?key|secret|token|password)\b\s*[:=]\s*["']?[A-Za-z0-9_./+=-]{32,}/i.test(
      line
    )
  ) {
    return "generic_secret_assignment";
  }

  return null;
}

function isSecurityScanCandidate(path: string): boolean {
  const filename = path.split("/").at(-1) ?? path;

  if (SECURITY_SCAN_SKIP_FILES.has(filename)) {
    return false;
  }

  if (/^\.env($|\.)/.test(filename)) {
    return true;
  }

  return SECURITY_SCAN_EXTENSIONS.has(extname(filename));
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

function normalizeRelativePath(path: string): string {
  return path.split("\\").join("/");
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
