import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  createProgram,
  formatCliError,
  inferProgramName,
  localAgentPresetRunsVerifiersFirst,
  parseRequiredPositiveInteger,
  resolvePresetVerifierCommandOptions,
  requireVerifierCommandOptions,
  RunsteadCliError,
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

  it("exposes Codex readiness doctor", () => {
    const doctor = createProgram().commands.find(
      (command) => command.name() === "doctor"
    );

    expect(doctor?.options.map((option) => option.long)).toEqual(
      expect.arrayContaining(["--codex", "--worker", "--model"])
    );
  });

  it("exposes domain pack manifest generation", () => {
    const domain = createProgram().commands.find(
      (command) => command.name() === "domain"
    );

    expect(domain?.commands.map((command) => command.name())).toEqual(
      expect.arrayContaining([
        "install",
        "manifest",
        "maturity",
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

  it("exposes local config commands", () => {
    const config = createProgram().commands.find(
      (command) => command.name() === "config"
    );

    expect(config?.commands.map((command) => command.name())).toEqual(
      expect.arrayContaining(["get", "set"])
    );
    expect(
      config?.commands
        .find((command) => command.name() === "set")
        ?.options.map((option) => option.long)
    ).toContain("--cwd");
  });

  it("exposes run once model routing options", () => {
    const run = createProgram().commands.find((command) => command.name() === "run");

    expect(run?.options.map((option) => option.long)).toEqual(
      expect.arrayContaining([
        "--once",
        "--cwd",
        "--worker",
        "--provider",
        "--model",
        "--base-url",
        "--actor"
      ])
    );
  });

  it("exposes local agent run command", () => {
    const agent = createProgram().commands.find(
      (command) => command.name() === "agent"
    );
    const run = agent?.commands.find((command) => command.name() === "run");
    const inspect = agent?.commands.find((command) => command.name() === "inspect");
    const review = agent?.commands.find((command) => command.name() === "review");
    const test = agent?.commands.find((command) => command.name() === "test");
    const fix = agent?.commands.find((command) => command.name() === "fix");
    const repairTest = agent?.commands.find(
      (command) => command.name() === "repair-test"
    );
    const providers = agent?.commands.find((command) => command.name() === "providers");
    const report = agent?.commands.find((command) => command.name() === "report");
    const resume = agent?.commands.find((command) => command.name() === "resume");
    const undo = agent?.commands.find((command) => command.name() === "undo");

    expect(agent?.commands.map((command) => command.name())).toEqual(
      expect.arrayContaining([
        "providers",
        "run",
        "inspect",
        "review",
        "test",
        "fix",
        "repair-test",
        "report",
        "resume",
        "undo"
      ])
    );
    expect(run?.options.map((option) => option.long)).toEqual(
      expect.arrayContaining([
        "--worker",
        "--model",
        "--mode",
        "--preset",
        "--allowed",
        "--denied",
        "--verifier",
        "--max-turns",
        "--max-tool-calls",
        "--max-failed-tool-calls",
        "--actor"
      ])
    );
    expect(inspect?.options.map((option) => option.long)).toEqual(
      expect.arrayContaining([
        "--cwd",
        "--worker",
        "--model",
        "--depth",
        "--max-turns",
        "--max-tool-calls",
        "--max-failed-tool-calls",
        "--actor"
      ])
    );
    expect(review?.options.map((option) => option.long)).toEqual(
      expect.arrayContaining([
        "--cwd",
        "--worker",
        "--model",
        "--staged",
        "--base",
        "--unpushed",
        "--max-turns",
        "--max-tool-calls",
        "--max-failed-tool-calls",
        "--actor"
      ])
    );
    expect(test?.options.map((option) => option.long)).toEqual(
      expect.arrayContaining([
        "--cwd",
        "--worker",
        "--model",
        "--verifier",
        "--max-turns",
        "--max-tool-calls",
        "--max-failed-tool-calls",
        "--actor"
      ])
    );
    for (const command of [fix, repairTest]) {
      expect(command?.options.map((option) => option.long)).toEqual(
        expect.arrayContaining([
          "--cwd",
          "--worker",
          "--model",
          "--allowed",
          "--denied",
          "--verifier",
          "--max-turns",
          "--max-tool-calls",
          "--max-failed-tool-calls",
          "--actor"
        ])
      );
    }
    expect(providers?.options.map((option) => option.long)).toEqual(
      expect.arrayContaining(["--json"])
    );
    expect(report?.options.map((option) => option.long)).toEqual(
      expect.arrayContaining(["--cwd", "--json", "--markdown", "--actor"])
    );
    expect(resume?.options.map((option) => option.long)).toEqual(
      expect.arrayContaining(["--cwd", "--actor"])
    );
    expect(undo?.options.map((option) => option.long)).toEqual(
      expect.arrayContaining(["--cwd", "--allow-head-mismatch", "--actor"])
    );
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
    const launchReadiness = report?.commands.find(
      (command) => command.name() === "launch-readiness"
    );

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
    expect(launchReadiness?.options.map((option) => option.long)).toEqual(
      expect.arrayContaining(["--actor", "--cwd", "--domain", "--print"])
    );
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

  it("exposes startup evidence and gate commands", () => {
    const startup = createProgram().commands.find(
      (command) => command.name() === "startup"
    );
    const init = startup?.commands.find((command) => command.name() === "init");
    const onboard = startup?.commands.find((command) => command.name() === "onboard");
    const assess = startup?.commands.find((command) => command.name() === "assess");
    const context = startup?.commands.find((command) => command.name() === "context");
    const contextGenerate = context?.commands.find(
      (command) => command.name() === "generate"
    );
    const measurement = startup?.commands.find(
      (command) => command.name() === "measurement"
    );
    const measurementGenerate = measurement?.commands.find(
      (command) => command.name() === "generate"
    );
    const launch = startup?.commands.find((command) => command.name() === "launch");
    const launchAudit = launch?.commands.find((command) => command.name() === "audit");
    const launchSecurityBaseline = launch?.commands.find(
      (command) => command.name() === "security-baseline"
    );
    const launchPrepare = launch?.commands.find(
      (command) => command.name() === "prepare"
    );
    const launchReport = launch?.commands.find(
      (command) => command.name() === "report"
    );
    const launchSupportTriage = launch?.commands.find(
      (command) => command.name() === "support-triage"
    );
    const launchUiValidate = launch?.commands.find(
      (command) => command.name() === "ui-validate"
    );
    const launchBottleneckMap = launch?.commands.find(
      (command) => command.name() === "bottleneck-map"
    );
    const scale = startup?.commands.find((command) => command.name() === "scale");
    const scaleWorkflowRegistry = scale?.commands.find(
      (command) => command.name() === "workflow-registry"
    );
    const scaleMemoryCapture = scale?.commands.find(
      (command) => command.name() === "memory-capture"
    );
    const scaleIntegrationMap = scale?.commands.find(
      (command) => command.name() === "integration-map"
    );
    const scaleReport = scale?.commands.find((command) => command.name() === "report");
    const scaleSopGenerate = scale?.commands.find(
      (command) => command.name() === "sop-generate"
    );
    const scaleGtmVerify = scale?.commands.find(
      (command) => command.name() === "gtm-verify"
    );
    const hypothesis = startup?.commands.find(
      (command) => command.name() === "hypothesis"
    );
    const hypothesisAdd = hypothesis?.commands.find(
      (command) => command.name() === "add"
    );
    const evidence = startup?.commands.find((command) => command.name() === "evidence");
    const artifact = startup?.commands.find((command) => command.name() === "artifact");
    const remediate = startup?.commands.find(
      (command) => command.name() === "remediate"
    );
    const evidenceAdd = evidence?.commands.find((command) => command.name() === "add");
    const gate = startup?.commands.find((command) => command.name() === "gate");
    const gateCheck = gate?.commands.find((command) => command.name() === "check");

    expect(startup?.commands.map((command) => command.name())).toEqual(
      expect.arrayContaining([
        "artifact",
        "assess",
        "build-mvp",
        "context",
        "evidence",
        "gate",
        "hypothesis",
        "init",
        "launch",
        "launch-check",
        "measurement",
        "onboard",
        "remediate",
        "scale",
        "scale-check",
        "team"
      ])
    );
    expect(assess?.options.map((option) => option.long)).toEqual(
      expect.arrayContaining(["--actor", "--cwd", "--domain", "--stage"])
    );
    expect(init?.options.map((option) => option.long)).toEqual(
      expect.arrayContaining(["--cwd", "--force", "--profile", "--stage"])
    );
    expect(onboard?.options.map((option) => option.long)).toEqual(
      expect.arrayContaining(["--cwd", "--force", "--profile", "--write-ci"])
    );
    expect(contextGenerate?.options.map((option) => option.long)).toEqual(
      expect.arrayContaining([
        "--accepted-debt",
        "--actor",
        "--architecture",
        "--constraint",
        "--cwd",
        "--force"
      ])
    );
    expect(measurementGenerate?.options.map((option) => option.long)).toEqual(
      expect.arrayContaining([
        "--activation",
        "--actor",
        "--cwd",
        "--day7",
        "--day30",
        "--false-positive",
        "--force",
        "--retention"
      ])
    );
    expect(hypothesisAdd?.options.map((option) => option.long)).toEqual(
      expect.arrayContaining([
        "--actor",
        "--cwd",
        "--goal",
        "--kind",
        "--source",
        "--statement"
      ])
    );
    expect(launchAudit?.options.map((option) => option.long)).toEqual(
      expect.arrayContaining(["--actor", "--cwd"])
    );
    expect(launchSecurityBaseline?.options.map((option) => option.long)).toEqual(
      expect.arrayContaining(["--actor", "--cwd"])
    );
    expect(launchPrepare?.options.map((option) => option.long)).toEqual(
      expect.arrayContaining(["--actor", "--cwd", "--domain"])
    );
    expect(launchReport?.options.map((option) => option.long)).toEqual(
      expect.arrayContaining(["--actor", "--cwd", "--domain", "--print"])
    );
    expect(launchSupportTriage?.options.map((option) => option.long)).toEqual(
      expect.arrayContaining([
        "--actor",
        "--customer",
        "--cwd",
        "--outcome",
        "--request",
        "--severity",
        "--source"
      ])
    );
    expect(launchUiValidate?.options.map((option) => option.long)).toEqual(
      expect.arrayContaining([
        "--accessibility",
        "--actor",
        "--cwd",
        "--dom",
        "--flow",
        "--responsive",
        "--screenshot",
        "--url",
        "--viewport"
      ])
    );
    expect(launchBottleneckMap?.options.map((option) => option.long)).toEqual(
      expect.arrayContaining([
        "--actor",
        "--bottleneck",
        "--cwd",
        "--owner",
        "--system-of-record"
      ])
    );
    expect(scaleWorkflowRegistry?.options.map((option) => option.long)).toEqual(
      expect.arrayContaining([
        "--actor",
        "--approval-boundary",
        "--cwd",
        "--delegation-rule",
        "--workflow"
      ])
    );
    expect(scaleMemoryCapture?.options.map((option) => option.long)).toEqual(
      expect.arrayContaining(["--actor", "--cwd", "--knowledge", "--scope", "--source"])
    );
    expect(scaleIntegrationMap?.options.map((option) => option.long)).toEqual(
      expect.arrayContaining([
        "--actor",
        "--automation-coverage",
        "--cwd",
        "--integration",
        "--lock-in-signal"
      ])
    );
    expect(scaleReport?.options.map((option) => option.long)).toEqual(
      expect.arrayContaining(["--actor", "--cwd", "--period"])
    );
    expect(scaleSopGenerate?.options.map((option) => option.long)).toEqual(
      expect.arrayContaining(["--actor", "--cwd", "--owner", "--sop", "--workflow"])
    );
    expect(scaleGtmVerify?.options.map((option) => option.long)).toEqual(
      expect.arrayContaining([
        "--actor",
        "--claim",
        "--cwd",
        "--evidence",
        "--product-state"
      ])
    );
    expect(evidenceAdd?.options.map((option) => option.long)).toEqual(
      expect.arrayContaining([
        "--actor",
        "--content",
        "--cwd",
        "--decision",
        "--goal",
        "--hypothesis",
        "--source",
        "--summary",
        "--type"
      ])
    );
    expect(artifact?.commands.map((command) => command.name())).toEqual(
      expect.arrayContaining(["list", "show"])
    );
    expect(remediate?.options.map((option) => option.long)).toEqual(
      expect.arrayContaining([
        "--actor",
        "--cwd",
        "--domain",
        "--execute",
        "--max-tasks",
        "--model",
        "--stage",
        "--worker"
      ])
    );
    expect(gateCheck?.options.map((option) => option.long)).toEqual(
      expect.arrayContaining(["--actor", "--cwd", "--domain", "--stage"])
    );
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

  it("requires verifier command options for verifier-backed commands", () => {
    expect(() => requireVerifierCommandOptions([], "agent test")).toThrow(
      "agent test requires at least one --verifier name=command"
    );
    expect(() => requireVerifierCommandOptions(["broken"], "agent test")).toThrow(
      "--verifier must use name=command"
    );
    expect(requireVerifierCommandOptions(["test=pnpm test"], "agent test")).toEqual([
      {
        name: "test",
        command: "pnpm test"
      }
    ]);
  });

  it("resolves preset verifier contracts", async () => {
    await expect(
      resolvePresetVerifierCommandOptions({
        values: [],
        commandName: "agent run",
        preset: {
          preset: {
            id: "repair:test",
            verifierPolicy: "required"
          }
        }
      })
    ).rejects.toThrow("agent run preset repair:test requires at least one");

    await expect(
      resolvePresetVerifierCommandOptions({
        values: [],
        commandName: "agent run",
        preset: {
          preset: {
            id: "fix:small",
            verifierPolicy: "auto"
          }
        },
        discover: () =>
          Promise.resolve([
            {
              name: "test",
              command: "pnpm test"
            }
          ])
      })
    ).resolves.toEqual([
      {
        name: "test",
        command: "pnpm test"
      }
    ]);

    await expect(
      resolvePresetVerifierCommandOptions({
        values: [],
        commandName: "agent run",
        preset: {
          preset: {
            id: "test:triage",
            verifierPolicy: "required"
          },
          verifierCommands: [
            {
              name: "lint",
              command: "pnpm lint"
            }
          ]
        }
      })
    ).resolves.toEqual([
      {
        name: "lint",
        command: "pnpm lint"
      }
    ]);
    expect(localAgentPresetRunsVerifiersFirst("required")).toBe(true);
    expect(localAgentPresetRunsVerifiersFirst("auto")).toBe(false);
  });

  it("parses budget options as strict positive integers", () => {
    expect(parseRequiredPositiveInteger("1", "--max-tool-calls")).toBe(1);
    expect(parseRequiredPositiveInteger("42", "--max-tool-calls")).toBe(42);

    for (const value of ["0", "-1", "1abc", "abc", "1.5"]) {
      expect(() => parseRequiredPositiveInteger(value, "--max-tool-calls")).toThrow(
        "--max-tool-calls must be a positive integer"
      );
    }
  });

  it("formats CLI errors without stack traces by default", () => {
    const error = new RunsteadCliError(
      "--max-tool-calls must be a positive integer",
      "use --max-tool-calls 8"
    );

    expect(formatCliError(error)).toBe(
      "Error: --max-tool-calls must be a positive integer\nHint: use --max-tool-calls 8"
    );
    expect(formatCliError(error)).not.toContain("at ");
    expect(formatCliError(error, { debug: true })).toContain(
      "--max-tool-calls must be a positive integer"
    );
    expect(formatCliError(new Error("plain failure"))).toBe("Error: plain failure");
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
