import { constants } from "node:fs";
import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";

const RUNTIME_IGNORE_ENTRIES = [
  "state.db",
  "state.db-*",
  "evidence/",
  "logs/",
  "checkpoints/",
  "daemon/",
  "reports/",
  "manager.lock"
];
const GIT_INFO_RUNTIME_IGNORE_ENTRIES = RUNTIME_IGNORE_ENTRIES.map(
  (entry) => `.runstead/${entry}`
);
const RUNTIME_IGNORE_HEADER = "# Runstead runtime artifacts";

export async function writeRunsteadRuntimeIgnoreFile(
  root: string,
  force = false
): Promise<void> {
  await writeIgnoreFile(join(root, ".gitignore"), RUNTIME_IGNORE_ENTRIES, force);
}

export async function installGitInfoExclude(cwd: string): Promise<void> {
  const gitDir = await resolveGitDir(cwd);

  if (gitDir === undefined) {
    return;
  }

  const excludePath = join(gitDir, "info", "exclude");

  await mkdir(dirname(excludePath), { recursive: true });
  await writeIgnoreFile(excludePath, GIT_INFO_RUNTIME_IGNORE_ENTRIES);
}

async function writeIgnoreFile(
  path: string,
  entries: string[],
  force = false
): Promise<void> {
  const contents = formatIgnoreBlock(entries);

  if (force || !(await exists(path))) {
    await writeFile(path, contents, "utf8");
    return;
  }

  const current = await readFile(path, "utf8");
  const existingLines = new Set(current.split(/\r?\n/));
  const missing = entries.filter((entry) => !existingLines.has(entry));

  if (missing.length === 0) {
    return;
  }

  const separator = current.endsWith("\n") ? "\n" : "\n\n";

  await writeFile(path, `${current}${separator}${formatIgnoreBlock(missing)}`, "utf8");
}

async function resolveGitDir(cwd: string): Promise<string | undefined> {
  const dotGit = join(cwd, ".git");
  const dotGitStat = await safeStat(dotGit);

  if (dotGitStat === undefined) {
    return undefined;
  }

  if (dotGitStat.isDirectory()) {
    return dotGit;
  }

  if (!dotGitStat.isFile()) {
    return undefined;
  }

  const contents = await readFile(dotGit, "utf8");
  const match = /^gitdir:\s*(.+)$/m.exec(contents);

  if (match?.[1] === undefined) {
    return undefined;
  }

  const gitDir = match[1].trim();

  return isAbsolute(gitDir) ? gitDir : resolve(dirname(dotGit), gitDir);
}

async function safeStat(path: string) {
  try {
    return await stat(path);
  } catch {
    return undefined;
  }
}

function formatIgnoreBlock(entries: string[]): string {
  return `${RUNTIME_IGNORE_HEADER}\n${entries.join("\n")}\n`;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}
