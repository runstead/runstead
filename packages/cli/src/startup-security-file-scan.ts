import { readFile, readdir } from "node:fs/promises";
import { extname, join, relative } from "node:path";

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

export async function collectRepoFileIndex(cwd: string): Promise<string[]> {
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

export async function scanForSecretFindings(
  cwd: string,
  files: string[]
): Promise<string[]> {
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

function normalizeRelativePath(path: string): string {
  return path.split("\\").join("/");
}
