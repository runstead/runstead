#!/usr/bin/env node
import { basename, join } from "node:path";
import { Command } from "commander";
import { pathToFileURL } from "node:url";

import { getRunsteadStatus } from "./status.js";

export interface CreateProgramOptions {
  entrypoint?: string;
}

export function createProgram(options: CreateProgramOptions = {}): Command {
  const program = new Command();

  program
    .name(inferProgramName(options.entrypoint ?? process.argv[1]))
    .description("Control plane for long-running autonomous work agents.")
    .version("0.0.0");

  program
    .command("init")
    .description("Initialize .runstead state and the repo-maintenance domain pack.")
    .option("--cwd <path>", "Workspace directory")
    .option("--force", "Overwrite generated config files")
    .action(async (options: { cwd?: string; force?: boolean }) => {
      const { initRunstead } = await import("./init.js");
      const result = await initRunstead(options);

      console.log(`Initialized ${result.root}`);
      console.log(`Installed domain pack: ${result.domain}`);
      console.log(`Created SQLite state: ${result.stateDb}`);
    });

  program
    .command("status")
    .description("Show local Runstead initialization status.")
    .option("--cwd <path>", "Workspace directory")
    .action(async (options: { cwd?: string }) => {
      const status = await getRunsteadStatus(options.cwd);

      if (!status.initialized) {
        console.log(`Runstead is not initialized at ${status.root}`);
        return;
      }

      console.log(`Runstead initialized at ${status.root}`);
      console.log(`Domain: ${status.domain ?? "unknown"}`);

      const goals = status.goals ?? [];
      if (goals.length === 0) {
        console.log("Goals: none");
      } else {
        console.log("Goals:");
        for (const goal of goals) {
          console.log(`  ${goal.status.padEnd(9)} ${goal.id} ${goal.title}`);
        }
      }

      const taskCounts = status.tasks?.byStatus ?? {};
      const taskStatuses = Object.keys(taskCounts);
      if (taskStatuses.length === 0) {
        console.log("Tasks: none");
      } else {
        console.log("Tasks:");
        for (const taskStatus of taskStatuses) {
          console.log(`  ${taskStatus.padEnd(9)} ${taskCounts[taskStatus]}`);
        }
      }

      if (status.latestEvidence !== undefined) {
        console.log(
          `Latest evidence: ${status.latestEvidence.id} ${status.latestEvidence.type}`
        );
      }
    });

  program
    .command("doctor")
    .description("Check local Runstead state and scaffold health.")
    .option("--cwd <path>", "Workspace directory")
    .action(async (options: { cwd?: string }) => {
      const { doctorRunstead } = await import("./doctor.js");
      const result = await doctorRunstead(options);

      console.log(`Runstead doctor for ${result.root}`);

      for (const check of result.checks) {
        console.log(`[${check.status}] ${check.label}: ${check.message}`);
      }

      if (!result.ok) {
        process.exitCode = 1;
      }
    });

  program
    .command("resume")
    .description("Resume interrupted local work by requeueing interrupted tasks.")
    .option("--cwd <path>", "Workspace directory")
    .action(async (options: { cwd?: string }) => {
      const { resumeInterruptedTasks } = await import("./resume.js");
      const result = resumeInterruptedTasks(options);

      console.log(`Requeued tasks: ${result.requeuedTasks.length}`);
      for (const item of result.requeuedTasks) {
        console.log(`${item.task.id}: ${item.previousStatus} -> ${item.task.status}`);
      }
      console.log(`Failed tasks: ${result.failedTasks.length}`);
      for (const item of result.failedTasks) {
        console.log(`${item.task.id}: ${item.previousStatus} -> ${item.task.status}`);
      }
    });

  program
    .command("migrate")
    .description("Migrate legacy .team state into .runstead.")
    .argument("[source]", "Source state directory", ".team")
    .argument("[destination]", "Destination state directory", ".runstead")
    .option("--cwd <path>", "Workspace directory")
    .option("--force", "Overwrite the destination if it exists")
    .action(
      async (
        source: string,
        destination: string,
        options: { cwd?: string; force?: boolean }
      ) => {
        const { migrateRunsteadState } = await import("./migrate.js");
        const result = await migrateRunsteadState({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          source,
          destination,
          ...(options.force === undefined ? {} : { force: options.force })
        });

        console.log(`Migrated ${result.source} -> ${result.destination}`);
        if (result.overwritten) {
          console.log("Destination overwritten.");
        }
      }
    );

  program
    .command("run")
    .description("Run local work.")
    .option("--once", "Run at most one task")
    .option("--cwd <path>", "Workspace directory")
    .action(async (options: { once?: boolean; cwd?: string }) => {
      if (options.once !== true) {
        throw new Error("Only --once is supported in v0.0.1");
      }

      const { formatRunOnceReport, runOnce, runOnceExitCode } =
        await import("./run.js");
      const result = await runOnce(options);
      const exitCode = runOnceExitCode(result);

      console.log(formatRunOnceReport(result));
      if (exitCode !== 0) {
        process.exitCode = exitCode;
      }
    });

  const report = program.command("report").description("Generate reports.");

  report
    .command("weekly")
    .description("Generate a weekly Runstead maintenance report.")
    .option("--cwd <path>", "Workspace directory")
    .option("--week <YYYY-Www>", "ISO week to report, for example 2026-W20")
    .option("--print", "Print the generated markdown")
    .action(async (options: { cwd?: string; week?: string; print?: boolean }) => {
      const { generateWeeklyReport } = await import("./weekly-report.js");
      const result = await generateWeeklyReport({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        ...(options.week === undefined ? {} : { week: options.week })
      });

      console.log(`Generated weekly report: ${result.reportPath}`);
      console.log(`Week: ${result.week}`);

      if (options.print === true) {
        console.log("");
        console.log(result.markdown);
      }
    });

  const memory = program.command("memory").description("Manage governed memory.");

  memory
    .command("quarantine")
    .description("Record a memory candidate in quarantine.")
    .requiredOption("--scope <scope>", "Memory scope, for example repo:acme/app")
    .requiredOption("--type <type>", "Memory type")
    .requiredOption("--content <text>", "Memory candidate content")
    .option("--cwd <path>", "Workspace directory")
    .option("--source <ref>", "Source/provenance reference", collectValues, [])
    .option("--confidence <number>", "Confidence score from 0 to 1")
    .option("--created-by <id>", "Creator id")
    .option("--task <id>", "Source task id")
    .action(
      async (options: {
        cwd?: string;
        scope: string;
        type: string;
        content: string;
        source: string[];
        confidence?: string;
        createdBy?: string;
        task?: string;
      }) => {
        const { quarantineMemoryCandidate } = await import("./memory.js");
        const confidence = parseOptionalFloat(options.confidence, "--confidence");
        const result = quarantineMemoryCandidate({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          scope: options.scope,
          type: options.type,
          content: options.content,
          sourceRefs: options.source,
          ...(confidence === undefined ? {} : { confidence }),
          ...(options.createdBy === undefined ? {} : { createdBy: options.createdBy }),
          ...(options.task === undefined ? {} : { taskId: options.task })
        });

        console.log(`Quarantined memory: ${result.memory.id}`);
        console.log(`Scope: ${result.memory.scope}`);
        console.log(`Type: ${result.memory.type}`);
      }
    );

  const memoryFact = memory.command("fact").description("Manage project facts.");

  memoryFact
    .command("add")
    .description("Record a verified project fact from repo file sources.")
    .requiredOption("--scope <scope>", "Memory scope, for example repo:acme/app")
    .requiredOption("--content <text>", "Project fact content")
    .requiredOption("--source <file-ref>", "Trusted file: source", collectValues, [])
    .option("--cwd <path>", "Workspace directory")
    .option("--confidence <number>", "Confidence score from 0 to 1")
    .option("--created-by <id>", "Creator id")
    .option("--task <id>", "Source task id")
    .action(
      async (options: {
        cwd?: string;
        scope: string;
        content: string;
        source: string[];
        confidence?: string;
        createdBy?: string;
        task?: string;
      }) => {
        const { recordProjectFact } = await import("./memory.js");
        const confidence = parseOptionalFloat(options.confidence, "--confidence");
        const result = recordProjectFact({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          scope: options.scope,
          content: options.content,
          sourceRefs: options.source,
          ...(confidence === undefined ? {} : { confidence }),
          ...(options.createdBy === undefined ? {} : { createdBy: options.createdBy }),
          ...(options.task === undefined ? {} : { taskId: options.task })
        });

        console.log(`Recorded project fact: ${result.memory.id}`);
        console.log(`Scope: ${result.memory.scope}`);
      }
    );

  memoryFact
    .command("list")
    .description("List verified project facts.")
    .option("--cwd <path>", "Workspace directory")
    .option("--scope <scope>", "Filter by memory scope")
    .action(async (options: { cwd?: string; scope?: string }) => {
      const { listProjectFacts } = await import("./memory.js");
      const result = listProjectFacts({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        ...(options.scope === undefined ? {} : { scope: options.scope })
      });

      if (result.facts.length === 0) {
        console.log("No project facts found.");
        return;
      }

      for (const fact of result.facts) {
        console.log(
          `${fact.id} ${fact.scope} confidence=${fact.confidence}: ${fact.content}`
        );
      }
    });

  memoryFact
    .command("search")
    .description("Retrieve verified project facts and record a retrieval audit event.")
    .option("--cwd <path>", "Workspace directory")
    .option("--scope <scope>", "Filter by memory scope")
    .option("--query <text>", "Search text")
    .option("--limit <number>", "Maximum facts to return")
    .action(
      async (options: {
        cwd?: string;
        scope?: string;
        query?: string;
        limit?: string;
      }) => {
        const { retrieveProjectFacts } = await import("./memory.js");
        const limit = parseOptionalInteger(options.limit, "--limit");
        const result = retrieveProjectFacts({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          ...(options.scope === undefined ? {} : { scope: options.scope }),
          ...(options.query === undefined ? {} : { query: options.query }),
          ...(limit === undefined ? {} : { limit })
        });

        console.log(`Retrieval audit: ${result.retrievalId}`);

        if (result.facts.length === 0) {
          console.log("No project facts found.");
          return;
        }

        for (const fact of result.facts) {
          console.log(
            `${fact.id} ${fact.scope} confidence=${fact.confidence}: ${fact.content}`
          );
        }
      }
    );

  const skill = program.command("skill").description("Manage skill packages.");

  const skillCandidate = skill
    .command("candidate")
    .description("Manage skill candidates.");

  skillCandidate
    .command("create")
    .description("Create a candidate skill package scaffold.")
    .argument("<name>", "Skill package name in lowercase kebab-case")
    .requiredOption("--description <text>", "Skill description")
    .option("--dir <path>", "Skill package root directory")
    .option("--domain <domain>", "Skill domain", "repo-maintenance")
    .option("--trigger <trigger>", "Skill trigger", collectValues, [])
    .option("--allowed-tool <tool>", "Allowed tool contract", collectValues, [])
    .option("--denied-tool <tool>", "Denied tool contract", collectValues, [])
    .option("--verifier-command <command>", "Verifier command", collectValues, [])
    .option("--task <id>", "Provenance task id", collectValues, [])
    .option("--scope-repo <repo>", "Scoped repository", collectValues, [])
    .option("--author <id>", "Skill candidate author")
    .action(
      async (
        name: string,
        options: {
          description: string;
          dir?: string;
          domain: string;
          trigger: string[];
          allowedTool: string[];
          deniedTool: string[];
          verifierCommand: string[];
          task: string[];
          scopeRepo: string[];
          author?: string;
        }
      ) => {
        const { createSkillCandidatePackage, formatSkillValidationReport } =
          await import("@runstead/skills");
        const result = await createSkillCandidatePackage({
          root: options.dir ?? join(process.cwd(), "skills", name),
          name,
          domain: options.domain,
          description: options.description,
          triggers: options.trigger,
          allowedTools: options.allowedTool,
          deniedTools: options.deniedTool,
          verifierCommands: options.verifierCommand,
          provenanceTasks: options.task,
          ...(options.scopeRepo.length === 0 ? {} : { scopeRepos: options.scopeRepo }),
          ...(options.author === undefined ? {} : { author: options.author })
        });

        console.log(`Created skill candidate: ${result.root}`);
        console.log(formatSkillValidationReport(result.validation));

        if (!result.validation.valid) {
          process.exitCode = 1;
        }
      }
    );

  skill
    .command("validate")
    .description("Validate a Runstead skill package directory.")
    .argument("<path>", "Skill package directory")
    .action(async (path: string) => {
      const { formatSkillValidationReport, validateSkillPackageDir } =
        await import("@runstead/skills");
      const result = await validateSkillPackageDir(path);

      console.log(formatSkillValidationReport(result));

      if (!result.valid) {
        process.exitCode = 1;
      }
    });

  const goal = program.command("goal").description("Manage durable goals.");

  goal
    .command("create")
    .description("Create a goal from a domain pack template.")
    .argument("[domain]", "Domain pack id", "repo-maintenance")
    .option("--cwd <path>", "Workspace directory")
    .option("--template <id>", "Goal template id")
    .option("--title <title>", "Override goal title")
    .action(
      async (
        domain: string,
        options: { cwd?: string; template?: string; title?: string }
      ) => {
        const { createGoal } = await import("./goals.js");
        const result = await createGoal({ ...options, domain });

        console.log(`Created goal: ${result.goal.id} ${result.goal.title}`);
        for (const item of result.generatedTasks) {
          console.log(`Created task: ${item.id} ${item.type}`);
        }
      }
    );

  goal
    .command("list")
    .description("List goals.")
    .option("--cwd <path>", "Workspace directory")
    .action(async (options: { cwd?: string }) => {
      const { listGoals } = await import("./goals.js");
      const result = listGoals(options);

      if (result.goals.length === 0) {
        console.log("No goals found.");
        return;
      }

      for (const item of result.goals) {
        console.log(`${item.status.padEnd(9)} ${item.id} ${item.title}`);
      }
    });

  goal
    .command("show")
    .description("Show a goal.")
    .argument("<id>", "Goal id")
    .option("--cwd <path>", "Workspace directory")
    .action(async (id: string, options: { cwd?: string }) => {
      const { showGoal } = await import("./goals.js");
      const result = showGoal({ ...options, id });

      console.log(`Goal: ${result.goal.id}`);
      console.log(`Title: ${result.goal.title}`);
      console.log(`Domain: ${result.goal.domain}`);
      console.log(`Status: ${result.goal.status}`);
      console.log(`Priority: ${result.goal.priority}`);
      console.log(`Policy: ${result.goal.policyRef ?? "none"}`);
      console.log(`Scope: ${JSON.stringify(result.goal.scope)}`);
    });

  const task = program.command("task").description("Manage durable tasks.");

  task
    .command("list")
    .description("List tasks.")
    .option("--cwd <path>", "Workspace directory")
    .option("--goal <id>", "Filter by goal id")
    .action(async (options: { cwd?: string; goal?: string }) => {
      const { listTasks } = await import("./tasks.js");
      const result = listTasks({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        ...(options.goal === undefined ? {} : { goalId: options.goal })
      });

      if (result.tasks.length === 0) {
        console.log("No tasks found.");
        return;
      }

      for (const item of result.tasks) {
        console.log(
          `${item.status.padEnd(9)} ${item.id} ${item.type} (${item.goalId})`
        );
      }
    });

  task
    .command("show")
    .description("Show a task.")
    .argument("<id>", "Task id")
    .option("--cwd <path>", "Workspace directory")
    .action(async (id: string, options: { cwd?: string }) => {
      const { showTask } = await import("./tasks.js");
      const result = showTask({ ...options, id });

      console.log(`Task: ${result.task.id}`);
      console.log(`Goal: ${result.task.goalId}`);
      console.log(`Domain: ${result.task.domain}`);
      console.log(`Type: ${result.task.type}`);
      console.log(`Status: ${result.task.status}`);
      console.log(`Priority: ${result.task.priority}`);
      console.log(`Attempt: ${result.task.attempt}/${result.task.maxAttempts}`);
      console.log(`Input: ${JSON.stringify(result.task.input)}`);
      console.log(`Verifiers: ${result.task.verifiers.join(", ")}`);
    });

  const verifier = program.command("verifier").description("Run verifiers.");

  verifier
    .command("run")
    .description("Run verifier commands for a task.")
    .argument("<task-id>", "Task id")
    .option("--cwd <path>", "Workspace directory")
    .option("--timeout-ms <ms>", "Per-command timeout in milliseconds")
    .action(async (taskId: string, options: { cwd?: string; timeoutMs?: string }) => {
      const { runTaskVerifiers } = await import("./verifier-runner.js");
      const timeoutMs =
        options.timeoutMs === undefined
          ? undefined
          : Number.parseInt(options.timeoutMs, 10);

      if (timeoutMs !== undefined && (!Number.isFinite(timeoutMs) || timeoutMs <= 0)) {
        throw new Error("--timeout-ms must be a positive integer");
      }

      const result = await runTaskVerifiers({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        taskId,
        ...(timeoutMs === undefined ? {} : { timeoutMs })
      });

      console.log(`Task: ${result.task.id}`);
      console.log(`Status: ${result.task.status}`);
      for (const command of result.commandResults) {
        console.log(
          `${command.verifier}: exit=${command.exitCode ?? "unknown"} evidence=${command.evidenceId}`
        );
      }
    });

  verifier
    .command("diff-scope")
    .description("Verify changed files stay within the configured diff scope.")
    .option("--cwd <path>", "Workspace directory")
    .option("--base <ref>", "Base ref")
    .option("--head <ref>", "Head ref", "HEAD")
    .option("--allowed <pattern>", "Allowed path pattern", collectValues, [])
    .option("--denied <pattern>", "Denied path pattern", collectValues, [])
    .action(
      async (options: {
        cwd?: string;
        base?: string;
        head?: string;
        allowed: string[];
        denied: string[];
      }) => {
        const { formatGitDiffScopeReport, verifyGitDiffScope } =
          await import("./diff-scope-verifier.js");
        const result = await verifyGitDiffScope({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          ...(options.base === undefined ? {} : { baseRef: options.base }),
          ...(options.head === undefined ? {} : { headRef: options.head }),
          allowedPaths: options.allowed,
          deniedPaths: options.denied
        });

        console.log(formatGitDiffScopeReport(result));
        if (!result.passed) {
          process.exitCode = 1;
        }
      }
    );

  const github = program.command("github").description("GitHub integration.");
  const githubRun = github.command("run").description("Inspect GitHub workflow runs.");

  githubRun
    .command("status")
    .description("Show GitHub workflow run status.")
    .argument("<run-id>", "GitHub Actions workflow run id")
    .option("--cwd <path>", "Workspace directory")
    .action(async (runId: string, options: { cwd?: string }) => {
      const { formatWorkflowRunStatus, getGitHubWorkflowRunStatus } =
        await import("./github-actions.js");
      const result = await getGitHubWorkflowRunStatus({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        runId
      });

      console.log(formatWorkflowRunStatus(result));
    });

  githubRun
    .command("logs")
    .description("Print GitHub workflow run logs.")
    .argument("<run-id>", "GitHub Actions workflow run id")
    .option("--cwd <path>", "Workspace directory")
    .action(async (runId: string, options: { cwd?: string }) => {
      const { fetchGitHubWorkflowRunLog } = await import("./github-actions.js");
      const result = await fetchGitHubWorkflowRunLog({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        runId
      });

      process.stdout.write(result.log);
    });

  const githubPr = github.command("pr").description("Create GitHub pull requests.");

  githubPr
    .command("create")
    .description("Create a GitHub pull request with Runstead evidence.")
    .requiredOption("--title <title>", "Pull request title")
    .requiredOption("--base <ref>", "Base branch")
    .requiredOption("--head <ref>", "Head branch")
    .option("--cwd <path>", "Workspace directory")
    .option("--body <body>", "Pull request body")
    .option("--draft", "Create a draft pull request")
    .option("--task <id>", "Runstead task id")
    .option("--goal <id>", "Runstead goal id")
    .option("--evidence <summary>", "Evidence summary", collectValues, [])
    .action(
      async (options: {
        cwd?: string;
        title: string;
        base: string;
        head: string;
        body?: string;
        draft?: boolean;
        task?: string;
        goal?: string;
        evidence: string[];
      }) => {
        const { createGitHubPullRequest } = await import("./github-pr.js");
        const result = await createGitHubPullRequest({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          title: options.title,
          base: options.base,
          head: options.head,
          ...(options.body === undefined ? {} : { body: options.body }),
          ...(options.draft === undefined ? {} : { draft: options.draft }),
          ...(options.task === undefined ? {} : { taskId: options.task }),
          ...(options.goal === undefined ? {} : { goalId: options.goal }),
          evidence: evidenceSummariesFromCli(options.evidence)
        });

        console.log(`Created PR: ${result.url ?? result.stdout.trim()}`);
      }
    );

  const git = program.command("git").description("Git helpers for repo maintenance.");
  const gitBranch = git.command("branch").description("Manage Runstead git branches.");

  gitBranch
    .command("create")
    .description("Create a git branch without overwriting existing branches.")
    .argument("<branch-name>", "Branch name")
    .option("--cwd <path>", "Workspace directory")
    .option("--base <ref>", "Base ref")
    .action(async (branchName: string, options: { cwd?: string; base?: string }) => {
      const { createGitBranch } = await import("./git-branch.js");
      const result = await createGitBranch({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        branchName,
        ...(options.base === undefined ? {} : { baseRef: options.base })
      });

      console.log(`Created branch: ${result.branchName}`);
    });

  const policy = program.command("policy").description("Evaluate policies.");

  policy
    .command("test")
    .description("Evaluate a policy YAML file against an action YAML file.")
    .argument("<policy>", "Policy YAML path")
    .requiredOption("--action <path>", "Action envelope YAML path")
    .action(async (policyPath: string, options: { action: string }) => {
      const { formatPolicyTestReport, testPolicyAction } =
        await import("./policy-command.js");
      const result = await testPolicyAction({
        policyPath,
        actionPath: options.action
      });

      console.log(formatPolicyTestReport(result));
    });

  return program;
}

export function inferProgramName(entrypoint?: string): "runstead" | "team" {
  return entrypoint !== undefined && basename(entrypoint) === "team"
    ? "team"
    : "runstead";
}

function collectValues(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function evidenceSummariesFromCli(values: string[]) {
  return values.map((summary, index) => ({
    id: `cli_evidence_${index + 1}`,
    type: "manual",
    summary
  }));
}

function parseOptionalFloat(
  value: string | undefined,
  optionName: string
): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number.parseFloat(value);

  if (!Number.isFinite(parsed)) {
    throw new Error(`${optionName} must be a number`);
  }

  return parsed;
}

function parseOptionalInteger(
  value: string | undefined,
  optionName: string
): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);

  if (!Number.isInteger(parsed)) {
    throw new Error(`${optionName} must be an integer`);
  }

  return parsed;
}

const entrypoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : undefined;

if (entrypoint === import.meta.url) {
  await createProgram({
    ...(process.argv[1] === undefined ? {} : { entrypoint: process.argv[1] })
  }).parseAsync(process.argv);
}
