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

  it("exposes RBAC actor selection on task execution commands", () => {
    const run = createProgram().commands.find((command) => command.name() === "run");
    const verifier = createProgram().commands.find(
      (command) => command.name() === "verifier"
    );
    const verifierRun = verifier?.commands.find((command) => command.name() === "run");
    const verifierDiffScope = verifier?.commands.find(
      (command) => command.name() === "diff-scope"
    );

    expect(run?.options.map((option) => option.long)).toContain("--actor");
    expect(verifierRun?.options.map((option) => option.long)).toContain("--actor");
    expect(verifierDiffScope?.options.map((option) => option.long)).toContain(
      "--actor"
    );
  });

  it("exposes RBAC actor selection on audit and report commands", () => {
    const audit = createProgram().commands.find(
      (command) => command.name() === "audit"
    );
    const report = createProgram().commands.find(
      (command) => command.name() === "report"
    );
    const auditExport = audit?.commands.find((command) => command.name() === "export");
    const weekly = report?.commands.find((command) => command.name() === "weekly");

    expect(auditExport?.options.map((option) => option.long)).toContain("--actor");
    expect(weekly?.options.map((option) => option.long)).toContain("--actor");
  });

  it("exposes RBAC actor selection on approval commands", () => {
    const approval = createProgram().commands.find(
      (command) => command.name() === "approval"
    );

    for (const commandName of ["list", "show", "approve", "deny"]) {
      const command = approval?.commands.find((item) => item.name() === commandName);

      expect(command?.options.map((option) => option.long)).toContain("--actor");
    }
  });

  it("exposes RBAC actor selection on goal and task commands", () => {
    const goal = createProgram().commands.find((command) => command.name() === "goal");
    const task = createProgram().commands.find((command) => command.name() === "task");

    for (const commandName of ["create", "list", "show"]) {
      const command = goal?.commands.find((item) => item.name() === commandName);

      expect(command?.options.map((option) => option.long)).toContain("--actor");
    }

    for (const commandName of ["list", "show"]) {
      const command = task?.commands.find((item) => item.name() === commandName);

      expect(command?.options.map((option) => option.long)).toContain("--actor");
    }
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

  it("exposes RBAC actor selection on team policy commands", () => {
    const teamPolicy = createProgram().commands.find(
      (command) => command.name() === "team-policy"
    );

    for (const commandName of ["init", "show", "compile"]) {
      const command = teamPolicy?.commands.find((item) => item.name() === commandName);

      expect(command?.options.map((option) => option.long)).toContain("--actor");
    }
  });

  it("exposes RBAC actor selection on RBAC grant", () => {
    const rbac = createProgram().commands.find((command) => command.name() === "rbac");
    const grant = rbac?.commands.find((command) => command.name() === "grant");

    expect(grant?.options.map((option) => option.long)).toContain("--actor");
  });

  it("exposes RBAC actor selection on memory commands", () => {
    const memory = createProgram().commands.find(
      (command) => command.name() === "memory"
    );
    const fact = memory?.commands.find((command) => command.name() === "fact");

    expect(
      memory?.commands
        .find((command) => command.name() === "quarantine")
        ?.options.map((option) => option.long)
    ).toContain("--actor");

    for (const commandName of ["add", "list", "search"]) {
      const command = fact?.commands.find((item) => item.name() === commandName);

      expect(command?.options.map((option) => option.long)).toContain("--actor");
    }
  });

  it("exposes RBAC actor selection on GitHub App mode", () => {
    const github = createProgram().commands.find(
      (command) => command.name() === "github"
    );
    const app = github?.commands.find((command) => command.name() === "app");

    for (const commandName of ["init", "status", "jwt", "token"]) {
      const command = app?.commands.find((item) => item.name() === commandName);

      expect(command?.options.map((option) => option.long)).toContain("--actor");
    }
  });

  it("exposes RBAC actor selection on GitHub integration commands", () => {
    const github = createProgram().commands.find(
      (command) => command.name() === "github"
    );
    const run = github?.commands.find((command) => command.name() === "run");
    const pr = github?.commands.find((command) => command.name() === "pr");

    for (const commandName of ["status", "logs", "repair", "orchestrate-repair"]) {
      const command = run?.commands.find((item) => item.name() === commandName);

      expect(command?.options.map((option) => option.long)).toContain("--actor");
    }

    expect(
      pr?.commands
        .find((command) => command.name() === "create")
        ?.options.map((option) => option.long)
    ).toContain("--actor");
  });

  it("exposes RBAC actor selection on git branch helpers", () => {
    const git = createProgram().commands.find((command) => command.name() === "git");
    const branch = git?.commands.find((command) => command.name() === "branch");
    const create = branch?.commands.find((command) => command.name() === "create");

    expect(create?.options.map((option) => option.long)).toContain("--actor");
  });
});
