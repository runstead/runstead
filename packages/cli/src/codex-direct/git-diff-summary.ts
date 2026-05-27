import type { ShellCommandResult } from "../shell-executor.js";

export function mergeDiffSummaryRows(input: { numstat: string; nameStatus: string }): {
  path: string;
  status?: string;
  additions: number | "binary";
  deletions: number | "binary";
}[] {
  const statuses = new Map<string, string>();

  for (const line of input.nameStatus.split(/\r?\n/)) {
    if (line.length === 0) {
      continue;
    }

    const [status, ...paths] = line.split("\t");
    const path = paths.at(-1);

    if (status !== undefined && path !== undefined) {
      statuses.set(path, status);
    }
  }

  return input.numstat
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    .map((line) => {
      const [added = "0", deleted = "0", path = ""] = line.split("\t");
      const additions = added === "-" ? "binary" : Number.parseInt(added, 10);
      const deletions = deleted === "-" ? "binary" : Number.parseInt(deleted, 10);
      const status = statuses.get(path);

      return {
        path,
        ...(status === undefined ? {} : { status }),
        additions:
          additions === "binary" ? "binary" : Number.isNaN(additions) ? 0 : additions,
        deletions:
          deletions === "binary" ? "binary" : Number.isNaN(deletions) ? 0 : deletions
      };
    });
}

export function diffSummaryTotals(
  files: {
    additions: number | "binary";
    deletions: number | "binary";
  }[]
): { files: number; additions: number; deletions: number; binaryFiles: number } {
  const totals = {
    files: 0,
    additions: 0,
    deletions: 0,
    binaryFiles: 0
  };

  for (const file of files) {
    totals.files += 1;

    if (file.additions === "binary" || file.deletions === "binary") {
      totals.binaryFiles += 1;
    }

    if (file.additions !== "binary") {
      totals.additions += file.additions;
    }

    if (file.deletions !== "binary") {
      totals.deletions += file.deletions;
    }
  }

  return totals;
}

export function firstNonZeroExitCode(results: ShellCommandResult[]): number {
  return results.find((result) => result.exitCode !== 0)?.exitCode ?? 0;
}
