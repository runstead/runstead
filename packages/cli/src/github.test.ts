import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import {
  DEFAULT_GITHUB_REPOSITORY_GIT_MAX_OUTPUT_BYTES,
  inspectGitHubRepository,
  parseGitHubRemoteUrl
} from "./github.js";

const execFileAsync = promisify(execFile);

describe("parseGitHubRemoteUrl", () => {
  it("parses common GitHub remote URL formats", () => {
    expect(parseGitHubRemoteUrl("https://github.com/acme/widgets.git")).toEqual({
      owner: "acme",
      repo: "widgets",
      remoteUrl: "https://github.com/acme/widgets.git"
    });
    expect(parseGitHubRemoteUrl("git@github.com:acme/widgets.git")).toEqual({
      owner: "acme",
      repo: "widgets",
      remoteUrl: "git@github.com:acme/widgets.git"
    });
    expect(parseGitHubRemoteUrl("ssh://git@github.com/acme/widgets.git")).toEqual({
      owner: "acme",
      repo: "widgets",
      remoteUrl: "ssh://git@github.com/acme/widgets.git"
    });
  });

  it("ignores non-GitHub remotes", () => {
    expect(parseGitHubRemoteUrl("git@gitlab.com:acme/widgets.git")).toBeUndefined();
  });
});

describe("inspectGitHubRepository", () => {
  it("reads the configured GitHub origin remote", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-github-"));

    try {
      await execFileAsync("git", ["init"], { cwd: workspace });
      await execFileAsync(
        "git",
        ["remote", "add", "origin", "git@github.com:acme/widgets.git"],
        { cwd: workspace }
      );

      await expect(inspectGitHubRepository({ cwd: workspace })).resolves.toEqual({
        detected: true,
        cwd: workspace,
        remote: "origin",
        remoteUrl: "git@github.com:acme/widgets.git",
        repository: {
          owner: "acme",
          repo: "widgets",
          remoteUrl: "git@github.com:acme/widgets.git"
        }
      });
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("bounds git remote lookup with a timeout", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-github-timeout-"));
    const bin = join(workspace, "bin");
    const originalPath = process.env.PATH;

    try {
      await mkdir(bin, { recursive: true });
      const fakeGitPath = join(bin, "git");
      await writeFile(fakeGitPath, "#!/usr/bin/env sh\nsleep 2\n", "utf8");
      await chmod(fakeGitPath, 0o755);
      process.env.PATH = `${bin}:${originalPath ?? ""}`;

      await expect(
        inspectGitHubRepository({
          cwd: workspace,
          gitMaxOutputBytes: DEFAULT_GITHUB_REPOSITORY_GIT_MAX_OUTPUT_BYTES,
          gitTimeoutMs: 25
        })
      ).resolves.toEqual({
        detected: false,
        cwd: workspace,
        remote: "origin"
      });
    } finally {
      process.env.PATH = originalPath;
      await rm(workspace, { force: true, recursive: true });
    }
  });
});
