import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { inspectGitHubRepository, parseGitHubRemoteUrl } from "./github.js";

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
});
