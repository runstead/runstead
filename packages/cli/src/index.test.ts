import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { createProgram, inferProgramName } from "./index.js";

describe("cli entrypoint", () => {
  it("exposes runstead and legacy team binaries", async () => {
    const packageJson = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8")
    ) as {
      bin: Record<string, string>;
    };

    expect(packageJson.bin.runstead).toBe("./dist/index.js");
    expect(packageJson.bin.team).toBe("./dist/index.js");
  });

  it("uses the invoked binary name for help output", () => {
    expect(inferProgramName("/usr/local/bin/runstead")).toBe("runstead");
    expect(inferProgramName("/usr/local/bin/team")).toBe("team");
    expect(createProgram({ entrypoint: "/usr/local/bin/team" }).name()).toBe("team");
  });

  it("exposes domain pack manifest generation", () => {
    const domain = createProgram().commands.find(
      (command) => command.name() === "domain"
    );

    expect(domain?.commands.map((command) => command.name())).toEqual(
      expect.arrayContaining(["manifest"])
    );
  });

  it("exposes repository archiving", () => {
    const repo = createProgram().commands.find((command) => command.name() === "repo");

    expect(repo?.commands.map((command) => command.name())).toContain("archive");
  });

  it("exposes RBAC actor selection on repository commands", () => {
    const repo = createProgram().commands.find((command) => command.name() === "repo");

    for (const commandName of ["add", "list", "show", "archive"]) {
      const command = repo?.commands.find((item) => item.name() === commandName);

      expect(command?.options.map((option) => option.long)).toContain("--actor");
    }
  });

  it("exposes RBAC actor selection on daemon management", () => {
    const daemon = createProgram().commands.find(
      (command) => command.name() === "daemon"
    );

    expect(daemon?.options.map((option) => option.long)).toContain("--actor");
  });

  it("exposes RBAC actor selection on dashboard build", () => {
    const dashboard = createProgram().commands.find(
      (command) => command.name() === "dashboard"
    );
    const build = dashboard?.commands.find((command) => command.name() === "build");

    expect(build?.options.map((option) => option.long)).toContain("--actor");
  });

  it("exposes RBAC actor selection on webhook serving", () => {
    const webhook = createProgram().commands.find(
      (command) => command.name() === "webhook"
    );
    const serve = webhook?.commands.find((command) => command.name() === "serve");

    expect(serve?.options.map((option) => option.long)).toContain("--actor");
  });

  it("exposes RBAC actor selection on scheduler ticks", () => {
    const scheduler = createProgram().commands.find(
      (command) => command.name() === "scheduler"
    );
    const tick = scheduler?.commands.find((command) => command.name() === "tick");

    expect(tick?.options.map((option) => option.long)).toContain("--actor");
  });

  it("exposes RBAC actor selection on GitHub App mode", () => {
    const github = createProgram().commands.find(
      (command) => command.name() === "github"
    );
    const app = github?.commands.find((command) => command.name() === "app");

    for (const commandName of ["init", "status", "jwt"]) {
      const command = app?.commands.find((item) => item.name() === commandName);

      expect(command?.options.map((option) => option.long)).toContain("--actor");
    }
  });
});
