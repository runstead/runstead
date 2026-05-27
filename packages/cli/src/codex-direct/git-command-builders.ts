export function gitDiffCommand(input: {
  path: string | undefined;
  staged: boolean;
  base: string | undefined;
}): string {
  const base = input.staged
    ? "git diff --staged"
    : input.base === undefined
      ? "git diff"
      : `git diff --end-of-options ${shellQuote(
          `${safeGitRevision(input.base, "base")}...HEAD`
        )}`;

  return input.path === undefined ? base : `${base} -- ${shellQuote(input.path)}`;
}

export function gitDiffSummaryCommand(
  mode: "--numstat" | "--name-status" | "--shortstat",
  input: {
    path: string | undefined;
    staged: boolean;
    base: string | undefined;
  }
): string {
  const base = input.staged
    ? `git diff --staged ${mode}`
    : input.base === undefined
      ? `git diff ${mode}`
      : `git diff ${mode} --end-of-options ${shellQuote(
          `${safeGitRevision(input.base, "base")}...HEAD`
        )}`;

  return input.path === undefined ? base : `${base} -- ${shellQuote(input.path)}`;
}

export function gitLogCommand(input: {
  range: string | undefined;
  path: string | undefined;
  maxCommits: number;
}): string {
  const parts = [
    "git log",
    `--max-count=${input.maxCommits}`,
    "--date=iso-strict",
    "--pretty=format:%H%x1f%an%x1f%ae%x1f%aI%x1f%s"
  ];

  if (input.range !== undefined) {
    parts.push("--end-of-options", shellQuote(safeGitRevision(input.range, "range")));
  }

  if (input.path !== undefined) {
    parts.push("--", shellQuote(input.path));
  }

  return parts.join(" ");
}

export function gitShowCommand(input: {
  ref: string;
  path: string | undefined;
}): string {
  const parts = [
    "git show",
    "--stat",
    "--patch",
    "--find-renames",
    "--format=fuller",
    "--end-of-options",
    shellQuote(safeGitRevision(input.ref, "ref"))
  ];

  if (input.path !== undefined) {
    parts.push("--", shellQuote(input.path));
  }

  return parts.join(" ");
}

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function safeGitRevision(
  value: string,
  field: "base" | "range" | "ref"
): string {
  const trimmed = value.trim();

  if (trimmed.length === 0) {
    throw new Error(`Git revision argument ${field} must not be empty`);
  }

  if (trimmed.startsWith("-")) {
    throw new Error(`Git revision argument ${field} must not start with '-'`);
  }

  return trimmed;
}
