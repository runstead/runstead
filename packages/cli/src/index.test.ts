import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  createProgram,
  inferProgramName,
  requireSecretPrintAcknowledgement,
  requireUnmanagedHelperAcknowledgement
} from "./index.js";

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

  it("exposes init policy profile selection", () => {
    const init = createProgram().commands.find((command) => command.name() === "init");

    expect(init?.options.map((option) => option.long)).toContain("--profile");
  });

  it("exposes domain pack manifest generation", () => {
    const domain = createProgram().commands.find(
      (command) => command.name() === "domain"
    );

    expect(domain?.commands.map((command) => command.name())).toEqual(
      expect.arrayContaining([
        "install",
        "manifest",
        "pack",
        "show",
        "uninstall",
        "unpack",
        "upgrade",
        "verify-manifest"
      ])
    );
  });

  it("exposes deterministic domain pack bundle commands", () => {
    const domain = createProgram().commands.find(
      (command) => command.name() === "domain"
    );
    const pack = domain?.commands.find((command) => command.name() === "pack");
    const unpack = domain?.commands.find((command) => command.name() === "unpack");

    expect(pack?.options.map((option) => option.long)).toContain("--output");
    expect(unpack?.options.map((option) => option.long)).toEqual(
      expect.arrayContaining(["--force", "--output"])
    );
  });

  it("exposes Codex Direct credential commands", () => {
    const codex = createProgram().commands.find(
      (command) => command.name() === "codex"
    );

    expect(codex?.commands.map((command) => command.name())).toEqual(
      expect.arrayContaining(["login", "status", "logout", "models"])
    );
    expect(
      codex?.commands
        .find((command) => command.name() === "login")
        ?.options.map((option) => option.long)
    ).toEqual(expect.arrayContaining(["--import-codex-cli", "--yes"]));
    expect(
      codex?.commands
        .find((command) => command.name() === "models")
        ?.options.map((option) => option.long)
    ).toContain("--refresh");
  });

  it("exposes RBAC actor selection on domain registry commands", () => {
    const domain = createProgram().commands.find(
      (command) => command.name() === "domain"
    );

    for (const commandName of ["install", "uninstall", "upgrade"]) {
      const command = domain?.commands.find((item) => item.name() === commandName);

      expect(command?.options.map((option) => option.long)).toContain("--actor");
    }
  });

  it("exposes explicit scaffold upgrades", () => {
    expect(createProgram().commands.map((command) => command.name())).toContain(
      "upgrade"
    );
  });

  it("exposes repository archiving", () => {
    const repo = createProgram().commands.find((command) => command.name() === "repo");

    expect(repo?.commands.map((command) => command.name())).toContain("archive");
  });

  it("exposes RBAC actor selection on checkpoint restore", () => {
    const checkpoint = createProgram().commands.find(
      (command) => command.name() === "checkpoint"
    );
    const restore = checkpoint?.commands.find(
      (command) => command.name() === "restore"
    );

    expect(restore?.options.map((option) => option.long)).toContain("--actor");
  });

  it("exposes RBAC actor selection on resume", () => {
    const resume = createProgram().commands.find(
      (command) => command.name() === "resume"
    );

    expect(resume?.options.map((option) => option.long)).toContain("--actor");
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
    const auditTimeline = audit?.commands.find(
      (command) => command.name() === "timeline"
    );
    const auditReplay = audit?.commands.find((command) => command.name() === "replay");
    const weekly = report?.commands.find((command) => command.name() === "weekly");

    expect(auditExport?.options.map((option) => option.long)).toContain("--actor");
    expect(auditExport?.options.map((option) => option.long)).toContain("--type");
    expect(auditExport?.options.map((option) => option.long)).toContain(
      "--aggregate-type"
    );
    expect(auditExport?.options.map((option) => option.long)).toContain(
      "--aggregate-id"
    );
    expect(auditTimeline?.options.map((option) => option.long)).toContain("--actor");
    expect(auditTimeline?.options.map((option) => option.long)).toContain("--type");
    expect(auditReplay?.options.map((option) => option.long)).toContain("--actor");
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
    expect(daemon?.options.map((option) => option.long)).toContain("--status");
    expect(daemon?.options.map((option) => option.long)).toContain("--no-heartbeat");
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
    expect(serve?.options.map((option) => option.long)).toContain("--github-app");
    expect(serve?.options.map((option) => option.long)).toContain(
      "--orchestrate-repair"
    );
    expect(serve?.options.map((option) => option.long)).toContain("--verifier");
    expect(serve?.options.map((option) => option.long)).toContain("--model");
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

  it("exposes skill promotion and deprecation", () => {
    const skill = createProgram().commands.find(
      (command) => command.name() === "skill"
    );

    expect(skill?.commands.map((command) => command.name())).toContain("promote");
    expect(skill?.commands.map((command) => command.name())).toContain("deprecate");
    expect(
      skill?.commands
        .find((command) => command.name() === "promote")
        ?.options.map((option) => option.long)
    ).toContain("--promoted-by");
    expect(
      skill?.commands
        .find((command) => command.name() === "deprecate")
        ?.options.map((option) => option.long)
    ).toEqual(expect.arrayContaining(["--deprecated-by", "--reason"]));
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

    for (const commandName of ["jwt", "token"]) {
      const command = app?.commands.find((item) => item.name() === commandName);

      expect(command?.options.map((option) => option.long)).toContain("--print-secret");
    }
  });

  it("exposes RBAC actor selection on GitHub integration commands", () => {
    const github = createProgram().commands.find(
      (command) => command.name() === "github"
    );
    const repairCi = createProgram().commands.find(
      (command) => command.name() === "repair-ci"
    );
    const run = github?.commands.find((command) => command.name() === "run");
    const pr = github?.commands.find((command) => command.name() === "pr");

    for (const commandName of ["status", "logs", "repair", "orchestrate-repair"]) {
      const command = run?.commands.find((item) => item.name() === commandName);

      expect(command?.options.map((option) => option.long)).toContain("--actor");
      expect(command?.options.map((option) => option.long)).toContain("--github-app");
    }

    expect(
      run?.commands
        .find((command) => command.name() === "repair")
        ?.options.map((option) => option.long)
    ).toContain("--verifier");
    expect(repairCi?.options.map((option) => option.long)).toEqual(
      expect.arrayContaining([
        "--actor",
        "--github-app",
        "--installation-id",
        "--model",
        "--verifier",
        "--worker"
      ])
    );

    const prCreateOptions = pr?.commands
      .find((command) => command.name() === "create")
      ?.options.map((option) => option.long);

    expect(prCreateOptions).toContain("--actor");
    expect(prCreateOptions).toContain("--github-app");
    expect(prCreateOptions).toContain("--unmanaged");
  });

  it("exposes RBAC actor selection on git branch helpers", () => {
    const git = createProgram().commands.find((command) => command.name() === "git");
    const branch = git?.commands.find((command) => command.name() === "branch");
    const create = branch?.commands.find((command) => command.name() === "create");

    expect(create?.options.map((option) => option.long)).toContain("--actor");
    expect(create?.options.map((option) => option.long)).toContain("--unmanaged");
  });

  it("requires explicit acknowledgement for unmanaged mutating helpers", () => {
    const program = createProgram();
    const checkpoint = program.commands.find(
      (command) => command.name() === "checkpoint"
    );
    const restore = checkpoint?.commands.find(
      (command) => command.name() === "restore"
    );

    expect(restore?.options.map((option) => option.long)).toContain("--unmanaged");
    expect(() =>
      requireUnmanagedHelperAcknowledgement({}, "create GitHub pull requests")
    ).toThrow("Refusing to create GitHub pull requests");
    expect(() =>
      requireUnmanagedHelperAcknowledgement(
        { unmanaged: true },
        "create GitHub pull requests"
      )
    ).not.toThrow();
  });

  it("requires explicit acknowledgement before printing GitHub App credentials", () => {
    expect(() => requireSecretPrintAcknowledgement({}, "GitHub App JWTs")).toThrow(
      "Refusing to print GitHub App JWTs"
    );
    expect(() =>
      requireSecretPrintAcknowledgement({ printSecret: true }, "GitHub App JWTs")
    ).not.toThrow();
  });

  it("labels ad-hoc side-effect helpers as unmanaged", () => {
    const program = createProgram();
    const checkpoint = program.commands.find(
      (command) => command.name() === "checkpoint"
    );
    const verifier = program.commands.find((command) => command.name() === "verifier");
    const github = program.commands.find((command) => command.name() === "github");
    const git = program.commands.find((command) => command.name() === "git");
    const githubRun = github?.commands.find((command) => command.name() === "run");
    const githubPr = github?.commands.find((command) => command.name() === "pr");
    const gitBranch = git?.commands.find((command) => command.name() === "branch");
    const unmanagedCommands = [
      checkpoint?.commands.find((command) => command.name() === "restore"),
      verifier?.commands.find((command) => command.name() === "diff-scope"),
      githubRun?.commands.find((command) => command.name() === "status"),
      githubRun?.commands.find((command) => command.name() === "logs"),
      githubPr?.commands.find((command) => command.name() === "create"),
      gitBranch?.commands.find((command) => command.name() === "create")
    ];

    for (const command of unmanagedCommands) {
      expect(command?.description()).toContain("Unmanaged helper");
    }
  });
});
