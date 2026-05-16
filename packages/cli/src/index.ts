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

  addCiRepairOrchestrationCommand(
    program
      .command("repair-ci")
      .description("Run the governed CI repair branch, worker, verifier, and PR loop.")
  );
  addCodexCommand(
    program
      .command("codex")
      .description("Manage experimental Codex Direct provider credentials.")
  );
  addAgentCommand(
    program.command("agent").description("Run local repo agent tasks.")
  );

  program
    .command("init")
    .description("Initialize .runstead state and the repo-maintenance domain pack.")
    .option("--cwd <path>", "Workspace directory")
    .option("--force", "Overwrite generated config files")
    .option(
      "--profile <profile>",
      "Policy profile to generate: default or trusted-local",
      "default"
    )
    .option("--create-default-goal", "Create the default repo-maintenance goal")
    .action(
      async (options: {
        cwd?: string;
        force?: boolean;
        profile?: "default" | "trusted-local";
        createDefaultGoal?: boolean;
      }) => {
        const { initRunstead } = await import("./init.js");
        const result = await initRunstead(options);

        console.log(`Initialized ${result.root}`);
        console.log(`Installed domain pack: ${result.domain}`);
        console.log(`Policy profile: ${result.profile}`);
        console.log(`Created SQLite state: ${result.stateDb}`);
        if (result.defaultGoal !== undefined) {
          console.log(
            `Created goal: ${result.defaultGoal.id} ${result.defaultGoal.title}`
          );
          for (const task of result.generatedTasks) {
            console.log(`Created task: ${task.id} ${task.type}`);
          }
        }
      }
    );

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
    .command("upgrade")
    .description("Apply missing scaffold defaults to an existing .runstead state.")
    .option("--cwd <path>", "Workspace directory")
    .action(async (options: { cwd?: string }) => {
      const { formatUpgradeRunsteadReport, upgradeRunsteadState } =
        await import("./upgrade.js");
      const result = await upgradeRunsteadState(options);

      console.log(formatUpgradeRunsteadReport(result));
    });

  program
    .command("resume")
    .description("Resume interrupted local work by requeueing interrupted tasks.")
    .option("--cwd <path>", "Workspace directory")
    .option("--actor <id>", "RBAC subject for task execution", "local-admin")
    .action(async (options: { cwd?: string; actor: string }) => {
      await requireRbacPermission({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        actor: options.actor,
        permission: "task.run",
        action: "resume tasks"
      });

      const { resumeInterruptedTasks } = await import("./resume.js");
      const result = await resumeInterruptedTasks(options);

      console.log(`Requeued tasks: ${result.requeuedTasks.length}`);
      for (const item of result.requeuedTasks) {
        console.log(`${item.task.id}: ${item.previousStatus} -> ${item.task.status}`);
      }
      console.log(`Failed tasks: ${result.failedTasks.length}`);
      for (const item of result.failedTasks) {
        console.log(`${item.task.id}: ${item.previousStatus} -> ${item.task.status}`);
      }
    });

  const checkpoint = program
    .command("checkpoint")
    .description("Manage workspace checkpoints and rollback.");

  checkpoint
    .command("restore")
    .description(
      "Restore workspace files from a checkpoint. Unmanaged helper; governed restores run through CI repair rollback."
    )
    .argument("<id>", "Checkpoint id")
    .option("--cwd <path>", "Workspace directory")
    .option(
      "--allow-head-mismatch",
      "Restore even when the current HEAD differs from the checkpoint HEAD"
    )
    .option("--actor <id>", "RBAC subject for checkpoint restore", "local-admin")
    .option("--unmanaged", "Acknowledge this helper bypasses governed runtime")
    .action(
      async (
        id: string,
        options: {
          cwd?: string;
          allowHeadMismatch?: boolean;
          actor: string;
          unmanaged?: boolean;
        }
      ) => {
        requireUnmanagedHelperAcknowledgement(options, "restore checkpoints");
        await requireRbacPermission({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          actor: options.actor,
          permission: "repo.manage",
          action: "restore checkpoints"
        });

        const {
          formatWorkspaceCheckpointRestoreReport,
          recordWorkspaceCheckpointRestoreEvent,
          restoreWorkspaceCheckpoint
        } = await import("./checkpoints.js");
        const { requireRunsteadRoot } = await import("./runstead-root.js");
        const resolved = await requireRunsteadRoot(options.cwd);
        const result = await restoreWorkspaceCheckpoint({
          workspace: resolved.cwd,
          checkpointDir: join(resolved.root, "checkpoints"),
          checkpointId: id,
          allowHeadMismatch: options.allowHeadMismatch === true
        });
        recordWorkspaceCheckpointRestoreEvent({
          stateDb: join(resolved.root, "state.db"),
          result,
          actor: options.actor
        });

        console.log(formatWorkspaceCheckpointRestoreReport(result));
      }
    );

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
    .option("--actor <id>", "RBAC subject for task execution", "local-admin")
    .action(async (options: { once?: boolean; cwd?: string; actor: string }) => {
      if (options.once !== true) {
        throw new Error("Only --once is supported in v0.0.1");
      }

      await requireRbacPermission({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        actor: options.actor,
        permission: "task.run",
        action: "run tasks"
      });

      const { formatRunOnceReport, runOnce, runOnceExitCode } =
        await import("./run.js");
      const result = await runOnce(options);
      const exitCode = runOnceExitCode(result);

      console.log(formatRunOnceReport(result));
      if (exitCode !== 0) {
        process.exitCode = exitCode;
      }
    });

  program
    .command("daemon")
    .description("Run the local Runstead daemon loop.")
    .option("--cwd <path>", "Workspace directory")
    .option("--once", "Run one daemon tick and exit")
    .option("--status", "Print the last daemon heartbeat and exit")
    .option("--max-ticks <number>", "Stop after this many ticks")
    .option("--interval-ms <number>", "Delay between ticks", "30000")
    .option("--no-scheduler", "Disable background scheduling before each tick")
    .option("--no-heartbeat", "Disable daemon heartbeat status writes")
    .option("--actor <id>", "RBAC subject for daemon management", "local-admin")
    .action(
      async (options: {
        cwd?: string;
        once?: boolean;
        status?: boolean;
        maxTicks?: string;
        intervalMs: string;
        scheduler?: boolean;
        heartbeat?: boolean;
        actor: string;
      }) => {
        const { checkPermission } = await import("./rbac.js");
        const permission = await checkPermission({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          subject: options.actor,
          permission: "daemon.manage"
        });

        if (permission.decision !== "allow") {
          throw new Error(
            `Subject ${options.actor} cannot manage daemon: ${permission.reason}`
          );
        }

        const { formatDaemonReport, formatDaemonStatus, readDaemonStatus, runDaemon } =
          await import("./daemon.js");

        if (options.status === true) {
          const status = await readDaemonStatus({
            ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
            staleAfterMs: parseRequiredInteger(options.intervalMs, "--interval-ms") * 2
          });
          console.log(formatDaemonStatus(status));
          return;
        }

        const maxTicks =
          options.once === true
            ? 1
            : parseOptionalInteger(options.maxTicks, "--max-ticks");
        const intervalMs = parseRequiredInteger(options.intervalMs, "--interval-ms");
        const result = await runDaemon({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          ...(maxTicks === undefined ? {} : { maxTicks }),
          intervalMs,
          schedulerEnabled: options.scheduler !== false,
          heartbeat: options.heartbeat !== false
        });

        console.log(formatDaemonReport(result));
      }
    );

  const scheduler = program
    .command("scheduler")
    .description("Manage background scheduling.");

  scheduler
    .command("tick")
    .description("Schedule due recurring tasks once.")
    .option("--cwd <path>", "Workspace directory")
    .option(
      "--interval-ms <number>",
      "Default recurrence interval for goals without scheduler metadata",
      "86400000"
    )
    .option("--now <iso>", "Override the current timestamp")
    .option("--actor <id>", "RBAC subject for scheduler management", "local-admin")
    .action(
      async (options: {
        cwd?: string;
        intervalMs: string;
        now?: string;
        actor: string;
      }) => {
        const { checkPermission } = await import("./rbac.js");
        const permission = await checkPermission({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          subject: options.actor,
          permission: "daemon.manage"
        });

        if (permission.decision !== "allow") {
          throw new Error(
            `Subject ${options.actor} cannot manage scheduler: ${permission.reason}`
          );
        }

        const { formatSchedulerReport, scheduleDueTasks } =
          await import("./scheduler.js");
        const result = await scheduleDueTasks({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          defaultIntervalMs: parseRequiredInteger(options.intervalMs, "--interval-ms"),
          ...(options.now === undefined
            ? {}
            : { now: parseDateOption(options.now, "--now") })
        });

        console.log(formatSchedulerReport(result));
      }
    );

  const webhook = program
    .command("webhook")
    .description("Run webhook receivers. Experimental.");

  webhook
    .command("serve")
    .description("Serve the GitHub webhook endpoint.")
    .option("--host <host>", "Host to bind", "127.0.0.1")
    .option("--port <number>", "Port to bind", "8787")
    .option("--cwd <path>", "Workspace directory")
    .option("--secret <secret>", "GitHub webhook secret")
    .option("--allow-unsigned", "Allow unsigned webhook requests")
    .option("--github-app", "Use configured GitHub App installation auth")
    .option("--installation-id <id>", "Override configured GitHub App installation id")
    .option(
      "--orchestrate-repair",
      "Run the governed CI repair loop for repairable workflow_run events"
    )
    .option(
      "--worker <worker>",
      "Worker to run when orchestrating repairs",
      "codex_cli"
    )
    .option("--model <model>", "Model to use with codex_direct")
    .option("--base <ref>", "PR base branch when orchestrating repairs")
    .option("--draft", "Create draft pull requests when orchestrating repairs")
    .option(
      "--allowed <pattern>",
      "Allowed changed path pattern when orchestrating repairs",
      collectValues,
      []
    )
    .option(
      "--denied <pattern>",
      "Denied changed path pattern when orchestrating repairs",
      collectValues,
      []
    )
    .option(
      "--verifier <name=command>",
      "Verifier command for orchestrated repairs",
      collectValues,
      []
    )
    .option("--actor <id>", "RBAC subject for webhook management", "local-admin")
    .action(
      async (options: {
        host: string;
        port: string;
        cwd?: string;
        secret?: string;
        allowUnsigned?: boolean;
        githubApp?: boolean;
        installationId?: string;
        orchestrateRepair?: boolean;
        worker: string;
        model?: string;
        base?: string;
        draft?: boolean;
        allowed: string[];
        denied: string[];
        verifier: string[];
        actor: string;
      }) => {
        const { checkPermission } = await import("./rbac.js");
        const permission = await checkPermission({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          subject: options.actor,
          permission: "webhook.manage"
        });

        if (permission.decision !== "allow") {
          throw new Error(
            `Subject ${options.actor} cannot manage webhooks: ${permission.reason}`
          );
        }

        if (options.secret === undefined && options.allowUnsigned !== true) {
          throw new Error(
            "GitHub webhook secret is required unless --allow-unsigned is set"
          );
        }

        const verifierCommands = options.verifier.map(parseVerifierCommandOption);

        if (options.orchestrateRepair === true && verifierCommands.length === 0) {
          throw new Error("--verifier is required when --orchestrate-repair is set");
        }

        const { createWebhookServer } = await import("./webhook-server.js");
        const { repairableWorkflowRunIdFromWebhook } = await import("./ci-repair.js");
        const { handleGitHubWorkflowRunWebhook, recordGitHubWorkflowRunWebhookEvent } =
          await import("./webhook-workflow-run.js");
        const port = parseRequiredInteger(options.port, "--port");
        const server = createWebhookServer({
          ...(options.secret === undefined ? {} : { secret: options.secret }),
          ...(options.allowUnsigned === undefined
            ? {}
            : { allowUnsigned: options.allowUnsigned }),
          handler: async (event) => {
            const runId = repairableWorkflowRunIdFromWebhook(
              event.event,
              event.payload
            );
            const authToken =
              runId === undefined ? undefined : await resolveGitHubAuthToken(options);

            await handleGitHubWorkflowRunWebhook({
              event: event.event,
              delivery: event.delivery,
              payload: event.payload,
              ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
              ...(authToken === undefined ? {} : { authToken }),
              mode: options.orchestrateRepair === true ? "orchestrate" : "intake",
              dedupeDelivery: true,
              worker: parseCiRepairWorkerKind(options.worker),
              ...(options.model === undefined ? {} : { model: options.model }),
              ...(options.base === undefined ? {} : { base: options.base }),
              draft: options.draft === true,
              allowedPaths: options.allowed,
              deniedPaths: options.denied,
              verifierCommands,
              audit: recordGitHubWorkflowRunWebhookEvent
            });
          }
        });

        server.listen(port, options.host, () => {
          console.log(`Runstead webhook server listening on ${options.host}:${port}`);
          console.log("GitHub endpoint: /webhooks/github");
        });
      }
    );

  const dashboard = program
    .command("dashboard")
    .description("Build dashboards. Experimental.");

  dashboard
    .command("build")
    .description("Build the local static dashboard.")
    .option("--cwd <path>", "Workspace directory")
    .option("--output <path>", "Dashboard output directory")
    .option("--actor <id>", "RBAC subject for dashboard generation", "local-admin")
    .action(async (options: { cwd?: string; output?: string; actor: string }) => {
      const { checkPermission } = await import("./rbac.js");
      const permission = await checkPermission({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        subject: options.actor,
        permission: "dashboard.manage"
      });

      if (permission.decision !== "allow") {
        throw new Error(
          `Subject ${options.actor} cannot build dashboard: ${permission.reason}`
        );
      }

      const { buildDashboard } = await import("./dashboard.js");
      const result = await buildDashboard({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        ...(options.output === undefined ? {} : { outputDir: options.output })
      });

      console.log(`Dashboard HTML: ${result.htmlPath}`);
      console.log(`Dashboard data: ${result.dataPath}`);
    });

  const rbac = program.command("rbac").description("Manage local RBAC. Experimental.");

  rbac
    .command("init")
    .description("Initialize the local RBAC policy.")
    .option("--cwd <path>", "Workspace directory")
    .option("--subject <id>", "Initial subject id", "local-admin")
    .option("--role <role>", "Initial role", "admin")
    .option("--force", "Overwrite an existing RBAC policy")
    .action(
      async (options: {
        cwd?: string;
        subject: string;
        role: string;
        force?: boolean;
      }) => {
        const { initRbac } = await import("./rbac.js");
        const result = await initRbac({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          subject: options.subject,
          role: options.role,
          ...(options.force === undefined ? {} : { force: options.force })
        });

        console.log(
          `${result.overwritten ? "Overwrote" : "Initialized"} RBAC policy: ${result.path}`
        );
      }
    );

  rbac
    .command("grant")
    .description("Grant a role to a subject.")
    .argument("<subject>", "Subject id")
    .argument("<role>", "Role name")
    .option("--cwd <path>", "Workspace directory")
    .option("--actor <id>", "RBAC subject for RBAC management", "local-admin")
    .action(
      async (
        subject: string,
        role: string,
        options: { cwd?: string; actor: string }
      ) => {
        const { grantRole } = await import("./rbac.js");
        const result = await grantRole({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          actor: options.actor,
          subject,
          role
        });

        console.log(`Granted ${role} to ${subject}`);
        console.log(`RBAC policy: ${result.path}`);
      }
    );

  rbac
    .command("check")
    .description("Check whether a subject has a permission.")
    .argument("<subject>", "Subject id")
    .argument("<permission>", "Permission name")
    .option("--cwd <path>", "Workspace directory")
    .action(async (subject: string, permission: string, options: { cwd?: string }) => {
      const { checkPermission, formatRbacCheckResult } = await import("./rbac.js");
      const result = await checkPermission({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        subject,
        permission
      });

      console.log(formatRbacCheckResult(result));
      if (result.decision === "deny") {
        process.exitCode = 1;
      }
    });

  const teamPolicy = program
    .command("team-policy")
    .description("Manage team policy overlays. Experimental.");

  teamPolicy
    .command("init")
    .description("Initialize the team policy source file.")
    .option("--cwd <path>", "Workspace directory")
    .option("--force", "Overwrite an existing team policy")
    .option("--actor <id>", "RBAC subject for team policy management", "local-admin")
    .action(async (options: { cwd?: string; force?: boolean; actor: string }) => {
      await requireRbacPermission({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        actor: options.actor,
        permission: "team_policy.manage",
        action: "manage team policy"
      });

      const { initTeamPolicy } = await import("./team-policy.js");
      const result = await initTeamPolicy({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        ...(options.force === undefined ? {} : { force: options.force })
      });

      console.log(
        `${result.overwritten ? "Overwrote" : "Initialized"} team policy: ${result.path}`
      );
    });

  teamPolicy
    .command("show")
    .description("Show the team policy summary.")
    .option("--cwd <path>", "Workspace directory")
    .option("--actor <id>", "RBAC subject for team policy access", "local-admin")
    .action(async (options: { cwd?: string; actor: string }) => {
      await requireRbacPermission({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        actor: options.actor,
        permission: "team_policy.read",
        action: "inspect team policy"
      });

      const { formatTeamPolicySummary, loadTeamPolicy } =
        await import("./team-policy.js");
      const policy = await loadTeamPolicy({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd })
      });

      console.log(formatTeamPolicySummary(policy));
    });

  teamPolicy
    .command("compile")
    .description("Compile the team policy into the Policy DSL.")
    .option("--cwd <path>", "Workspace directory")
    .option("--output <path>", "Compiled policy path")
    .option("--actor <id>", "RBAC subject for team policy management", "local-admin")
    .action(async (options: { cwd?: string; output?: string; actor: string }) => {
      await requireRbacPermission({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        actor: options.actor,
        permission: "team_policy.manage",
        action: "manage team policy"
      });

      const { compileTeamPolicy } = await import("./team-policy.js");
      const result = await compileTeamPolicy({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        ...(options.output === undefined ? {} : { output: options.output })
      });

      console.log(`Compiled team policy: ${result.outputPath}`);
      console.log(`Rules: ${result.policy.rules.length}`);
    });

  const audit = program.command("audit").description("Export audit data.");

  audit
    .command("export")
    .description("Export the append-only event log as JSONL.")
    .option("--cwd <path>", "Workspace directory")
    .option("--output <path>", "Write JSONL to a file instead of stdout")
    .option("--type <event-type>", "Filter by event type", collectValues, [])
    .option("--aggregate-type <type>", "Filter by aggregate type")
    .option("--aggregate-id <id>", "Filter by aggregate id")
    .option("--actor <id>", "RBAC subject for audit access", "local-admin")
    .action(
      async (options: {
        cwd?: string;
        output?: string;
        type: string[];
        aggregateType?: string;
        aggregateId?: string;
        actor: string;
      }) => {
        await requireRbacPermission({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          actor: options.actor,
          permission: "audit.read",
          action: "export audit logs"
        });

        const { exportAuditLog } = await import("./audit-export.js");
        const result = await exportAuditLog({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          ...(options.output === undefined ? {} : { outputPath: options.output }),
          ...(options.type.length === 0 ? {} : { types: options.type }),
          ...(options.aggregateType === undefined
            ? {}
            : { aggregateType: options.aggregateType }),
          ...(options.aggregateId === undefined
            ? {}
            : { aggregateId: options.aggregateId })
        });

        if (result.outputPath === undefined) {
          process.stdout.write(result.contents);
          return;
        }

        console.log(`Exported audit log: ${result.outputPath}`);
        console.log(`Events: ${result.entries.length}`);
      }
    );

  audit
    .command("timeline")
    .description("Print an ordered audit event timeline.")
    .option("--cwd <path>", "Workspace directory")
    .option("--type <event-type>", "Filter by event type", collectValues, [])
    .option("--aggregate-type <type>", "Filter by aggregate type")
    .option("--aggregate-id <id>", "Filter by aggregate id")
    .option("--actor <id>", "RBAC subject for audit access", "local-admin")
    .action(
      async (options: {
        cwd?: string;
        type: string[];
        aggregateType?: string;
        aggregateId?: string;
        actor: string;
      }) => {
        await requireRbacPermission({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          actor: options.actor,
          permission: "audit.read",
          action: "read audit timelines"
        });

        const { exportAuditLog, formatAuditTimeline } =
          await import("./audit-export.js");
        const result = await exportAuditLog({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          ...(options.type.length === 0 ? {} : { types: options.type }),
          ...(options.aggregateType === undefined
            ? {}
            : { aggregateType: options.aggregateType }),
          ...(options.aggregateId === undefined
            ? {}
            : { aggregateId: options.aggregateId })
        });

        console.log(formatAuditTimeline(result.entries));
      }
    );

  audit
    .command("replay")
    .description("Replay related audit events for a task lifecycle.")
    .argument("<task-id>", "Task id")
    .option("--cwd <path>", "Workspace directory")
    .option("--actor <id>", "RBAC subject for audit access", "local-admin")
    .action(async (taskId: string, options: { cwd?: string; actor: string }) => {
      await requireRbacPermission({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        actor: options.actor,
        permission: "audit.read",
        action: "replay audit lifecycles"
      });

      const { formatAuditReplay, replayAuditLifecycle } =
        await import("./audit-export.js");
      const result = await replayAuditLifecycle({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        taskId
      });

      console.log(formatAuditReplay(result));
    });

  const report = program.command("report").description("Generate reports.");

  report
    .command("weekly")
    .description("Generate a weekly Runstead maintenance report.")
    .option("--cwd <path>", "Workspace directory")
    .option("--week <YYYY-Www>", "ISO week to report, for example 2026-W20")
    .option("--print", "Print the generated markdown")
    .option("--actor <id>", "RBAC subject for report generation", "local-admin")
    .action(
      async (options: {
        cwd?: string;
        week?: string;
        print?: boolean;
        actor: string;
      }) => {
        await requireRbacPermission({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          actor: options.actor,
          permission: "audit.read",
          action: "generate reports"
        });

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
      }
    );

  const memory = program
    .command("memory")
    .description("Manage governed memory. Experimental.");

  memory
    .command("quarantine")
    .description("Record a memory candidate in quarantine.")
    .requiredOption("--scope <scope>", "Memory scope, for example repo:acme/app")
    .requiredOption("--type <type>", "Memory type")
    .requiredOption("--content <text>", "Memory candidate content")
    .option("--cwd <path>", "Workspace directory")
    .option("--source <ref>", "Source/provenance reference", collectValues, [])
    .option("--confidence <number>", "Confidence score from 0 to 1")
    .option("--expires-at <iso>", "Timestamp after which the fact is hidden by default")
    .option("--created-by <id>", "Creator id")
    .option("--task <id>", "Source task id")
    .option("--actor <id>", "RBAC subject for memory writes", "local-admin")
    .action(
      async (options: {
        cwd?: string;
        scope: string;
        type: string;
        content: string;
        source: string[];
        confidence?: string;
        expiresAt?: string;
        createdBy?: string;
        task?: string;
        actor: string;
      }) => {
        await requireRbacPermission({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          actor: options.actor,
          permission: "memory.write",
          action: "write memory"
        });

        const { quarantineMemoryCandidate } = await import("./memory.js");
        const confidence = parseOptionalFloat(options.confidence, "--confidence");
        const result = quarantineMemoryCandidate({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          scope: options.scope,
          type: options.type,
          content: options.content,
          sourceRefs: options.source,
          ...(confidence === undefined ? {} : { confidence }),
          ...(options.expiresAt === undefined
            ? {}
            : {
                expiresAt: parseDateOption(
                  options.expiresAt,
                  "--expires-at"
                ).toISOString()
              }),
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
    .option("--actor <id>", "RBAC subject for memory writes", "local-admin")
    .action(
      async (options: {
        cwd?: string;
        scope: string;
        content: string;
        source: string[];
        confidence?: string;
        createdBy?: string;
        task?: string;
        actor: string;
      }) => {
        await requireRbacPermission({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          actor: options.actor,
          permission: "memory.write",
          action: "write memory"
        });

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
    .option("--include-expired", "Include expired project facts")
    .option("--actor <id>", "RBAC subject for memory access", "local-admin")
    .action(
      async (options: {
        cwd?: string;
        scope?: string;
        includeExpired?: boolean;
        actor: string;
      }) => {
        await requireRbacPermission({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          actor: options.actor,
          permission: "memory.read",
          action: "read memory"
        });

        const { listProjectFacts } = await import("./memory.js");
        const result = listProjectFacts({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          ...(options.scope === undefined ? {} : { scope: options.scope }),
          includeExpired: options.includeExpired === true
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
      }
    );

  memoryFact
    .command("search")
    .description("Retrieve verified project facts and record a retrieval audit event.")
    .option("--cwd <path>", "Workspace directory")
    .option("--scope <scope>", "Filter by memory scope")
    .option("--query <text>", "Search text")
    .option("--limit <number>", "Maximum facts to return")
    .option("--include-conflicted", "Include facts with explicit conflicts")
    .option("--include-expired", "Include expired project facts")
    .option("--actor <id>", "RBAC subject for memory access", "local-admin")
    .action(
      async (options: {
        cwd?: string;
        scope?: string;
        query?: string;
        limit?: string;
        includeConflicted?: boolean;
        includeExpired?: boolean;
        actor: string;
      }) => {
        await requireRbacPermission({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          actor: options.actor,
          permission: "memory.read",
          action: "read memory"
        });

        const { retrieveProjectFacts } = await import("./memory.js");
        const limit = parseOptionalInteger(options.limit, "--limit");
        const result = retrieveProjectFacts({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          ...(options.scope === undefined ? {} : { scope: options.scope }),
          ...(options.query === undefined ? {} : { query: options.query }),
          ...(limit === undefined ? {} : { limit }),
          includeConflicted: options.includeConflicted === true,
          includeExpired: options.includeExpired === true
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

  const skill = program
    .command("skill")
    .description("Manage skill packages. Experimental.");

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

  skill
    .command("test")
    .description("Validate and run a skill package test script.")
    .argument("<path>", "Skill package directory")
    .action(async (path: string) => {
      const { formatSkillTestReport, runSkillPackageTests } =
        await import("@runstead/skills");
      const result = await runSkillPackageTests(path);

      console.log(formatSkillTestReport(result));

      if (!result.passed) {
        process.exitCode = 1;
      }
    });

  skill
    .command("promote")
    .description("Promote a candidate skill package after validation and tests pass.")
    .argument("<path>", "Skill package directory")
    .option("--promoted-by <id>", "Promoter identity", "local-admin")
    .action(async (path: string, options: { promotedBy: string }) => {
      const {
        formatSkillTestReport,
        formatSkillValidationReport,
        promoteSkillPackage
      } = await import("@runstead/skills");
      const result = await promoteSkillPackage({
        root: path,
        promotedBy: options.promotedBy
      });

      console.log(`Promoted skill package: ${result.root}`);
      console.log(formatSkillTestReport(result.test));
      console.log(formatSkillValidationReport(result.validation));
    });

  skill
    .command("deprecate")
    .description("Deprecate a promoted skill package.")
    .argument("<path>", "Skill package directory")
    .option("--deprecated-by <id>", "Deprecator identity", "local-admin")
    .option("--reason <text>", "Deprecation reason")
    .action(
      async (path: string, options: { deprecatedBy: string; reason?: string }) => {
        const { deprecateSkillPackage, formatSkillValidationReport } =
          await import("@runstead/skills");
        const result = await deprecateSkillPackage({
          root: path,
          deprecatedBy: options.deprecatedBy,
          ...(options.reason === undefined ? {} : { reason: options.reason })
        });

        console.log(`Deprecated skill package: ${result.root}`);
        console.log(formatSkillValidationReport(result.validation));
      }
    );

  const repo = program.command("repo").description("Manage registered repositories.");

  repo
    .command("add")
    .description("Register a repository for multi-repo operation.")
    .argument("[path]", "Repository path")
    .option("--cwd <path>", "Runstead control workspace directory")
    .option("--alias <alias>", "Stable repository alias")
    .option("--remote-url <url>", "Override detected remote URL")
    .option("--default-branch <branch>", "Override detected branch")
    .option("--tags <list>", "Comma-separated tags")
    .option("--actor <id>", "RBAC subject for repository management", "local-admin")
    .action(
      async (
        path: string | undefined,
        options: {
          cwd?: string;
          alias?: string;
          remoteUrl?: string;
          defaultBranch?: string;
          tags?: string;
          actor: string;
        }
      ) => {
        await requireRbacPermission({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          actor: options.actor,
          permission: "repo.manage",
          action: "manage repositories"
        });

        const { registerRepository } = await import("./repositories.js");
        const result = await registerRepository({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          ...(path === undefined ? {} : { path }),
          ...(options.alias === undefined ? {} : { alias: options.alias }),
          ...(options.remoteUrl === undefined ? {} : { remoteUrl: options.remoteUrl }),
          ...(options.defaultBranch === undefined
            ? {}
            : { defaultBranch: options.defaultBranch }),
          ...(options.tags === undefined
            ? {}
            : { tags: parseCommaSeparatedList(options.tags) })
        });

        console.log(
          `${result.created ? "Registered" : "Updated"} repository: ${result.repository.alias}`
        );
        console.log(`ID: ${result.repository.id}`);
        console.log(`Path: ${result.repository.localPath}`);
      }
    );

  repo
    .command("list")
    .description("List registered repositories.")
    .option("--cwd <path>", "Runstead control workspace directory")
    .option("--status <status>", "Filter by repository status")
    .option("--actor <id>", "RBAC subject for repository access", "local-admin")
    .action(async (options: { cwd?: string; status?: string; actor: string }) => {
      await requireRbacPermission({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        actor: options.actor,
        permission: "repo.read",
        action: "list repositories"
      });

      const { listRepositories } = await import("./repositories.js");
      const status = parseRepositoryStatus(options.status);
      const result = listRepositories({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        ...(status === undefined ? {} : { status })
      });

      if (result.repositories.length === 0) {
        console.log("No repositories found.");
        return;
      }

      for (const item of result.repositories) {
        console.log(
          `${item.status.padEnd(8)} ${item.id} ${item.alias} ${item.localPath}`
        );
      }
    });

  repo
    .command("show")
    .description("Show a registered repository.")
    .argument("<ref>", "Repository id, alias, or path")
    .option("--cwd <path>", "Runstead control workspace directory")
    .option("--actor <id>", "RBAC subject for repository access", "local-admin")
    .action(async (ref: string, options: { cwd?: string; actor: string }) => {
      await requireRbacPermission({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        actor: options.actor,
        permission: "repo.read",
        action: "inspect repositories"
      });

      const { showRepository } = await import("./repositories.js");
      const result = showRepository({ ...options, ref });

      console.log(`Repository: ${result.repository.id}`);
      console.log(`Alias: ${result.repository.alias}`);
      console.log(`Status: ${result.repository.status}`);
      console.log(`Path: ${result.repository.localPath}`);
      console.log(`Remote: ${result.repository.remoteUrl ?? "none"}`);
      console.log(`Default branch: ${result.repository.defaultBranch ?? "unknown"}`);
      console.log(`Tags: ${result.repository.tags.join(", ") || "none"}`);
    });

  repo
    .command("archive")
    .description("Archive a registered repository without deleting audit history.")
    .argument("<ref>", "Repository id, alias, or path")
    .option("--cwd <path>", "Runstead control workspace directory")
    .option("--actor <id>", "RBAC subject for repository management", "local-admin")
    .action(async (ref: string, options: { cwd?: string; actor: string }) => {
      await requireRbacPermission({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        actor: options.actor,
        permission: "repo.manage",
        action: "manage repositories"
      });

      const { archiveRepository } = await import("./repositories.js");
      const result = archiveRepository({ ...options, ref });

      console.log(`Archived repository: ${result.repository.alias}`);
      console.log(`Previous status: ${result.previousStatus}`);
      console.log(`Path: ${result.repository.localPath}`);
    });

  const domain = program
    .command("domain")
    .description("Manage domain packs. Experimental.");

  domain
    .command("create")
    .description("Create a starter custom domain pack.")
    .argument("<id>", "Domain pack id")
    .option("--output <path>", "Output directory")
    .option("--name <name>", "Display name")
    .option("--description <description>", "Description")
    .option("--force", "Overwrite existing generated files")
    .action(
      async (
        id: string,
        options: {
          output?: string;
          name?: string;
          description?: string;
          force?: boolean;
        }
      ) => {
        const { createDomainPackTemplate } = await import("@runstead/domain-packs");
        const result = await createDomainPackTemplate({
          id,
          ...(options.output === undefined ? {} : { outputDir: options.output }),
          ...(options.name === undefined ? {} : { name: options.name }),
          ...(options.description === undefined
            ? {}
            : { description: options.description }),
          ...(options.force === undefined ? {} : { force: options.force })
        });

        console.log(`Created domain pack: ${result.root}`);
        for (const file of result.files) {
          console.log(`Created file: ${file}`);
        }
      }
    );

  domain
    .command("list")
    .description("List discoverable domain packs.")
    .option("--cwd <path>", "Workspace directory")
    .option("--root <path>", "Additional domain pack root", collectValues, [])
    .option("--no-built-ins", "Exclude built-in domain packs")
    .action(async (options: { cwd?: string; root: string[]; builtIns?: boolean }) => {
      const { listDomainPacks } = await import("@runstead/domain-packs");
      const roots = [...options.root];

      if (options.cwd !== undefined) {
        const { resolveRunsteadRootSync } = await import("./runstead-root.js");
        roots.push(join(resolveRunsteadRootSync(options.cwd).root, "domains"));
      }

      const result = await listDomainPacks({
        roots,
        includeBuiltIns: options.builtIns !== false
      });

      if (result.entries.length === 0) {
        console.log("No domain packs found.");
      } else {
        for (const entry of result.entries) {
          console.log(`${entry.id.padEnd(24)} ${entry.source.padEnd(9)} ${entry.root}`);
        }
      }

      for (const issue of result.issues) {
        console.error(
          `${issue.severity.toUpperCase()} ${issue.code} ${issue.root}: ${issue.message}`
        );
      }
    });

  domain
    .command("show")
    .description("Show resolved domain pack metadata.")
    .argument("<ref>", "Domain pack id or path")
    .option("--cwd <path>", "Workspace directory")
    .option("--root <path>", "Additional domain pack root", collectValues, [])
    .option("--no-built-ins", "Exclude built-in domain packs")
    .action(
      async (
        ref: string,
        options: { cwd?: string; root: string[]; builtIns?: boolean }
      ) => {
        const { formatDomainPackShowResult, showDomainPack } =
          await import("./domain-pack-command.js");
        const result = await showDomainPack(ref, {
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          roots: options.root,
          includeBuiltIns: options.builtIns !== false
        });

        console.log(formatDomainPackShowResult(result));
      }
    );

  domain
    .command("install")
    .description("Install a validated domain pack into .runstead/domains.")
    .argument("<ref>", "Domain pack id or path")
    .option("--cwd <path>", "Workspace directory")
    .option("--root <path>", "Additional domain pack root", collectValues, [])
    .option("--no-built-ins", "Exclude built-in domain packs")
    .option("--force", "Overwrite an installed domain pack")
    .option("--actor <id>", "RBAC subject for domain pack management", "local-admin")
    .action(
      async (
        ref: string,
        options: {
          cwd?: string;
          root: string[];
          builtIns?: boolean;
          force?: boolean;
          actor: string;
        }
      ) => {
        await requireRbacPermission({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          actor: options.actor,
          permission: "domain.manage",
          action: "install domain packs"
        });

        const { installDomainPack } = await import("./domain-pack-install.js");
        const result = await installDomainPack({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          ref,
          roots: options.root,
          includeBuiltIns: options.builtIns !== false,
          force: options.force === true
        });

        console.log(
          `${result.overwritten ? "Reinstalled" : "Installed"} domain pack: ${result.id}`
        );
        console.log(`Destination: ${result.destination}`);
        console.log(`Manifest: ${result.manifestPath}`);
        console.log(`Files: ${result.installedFiles.length}`);
      }
    );

  domain
    .command("uninstall")
    .description("Remove an installed domain pack from .runstead/domains.")
    .argument("<id>", "Installed domain pack id")
    .option("--cwd <path>", "Workspace directory")
    .option("--force", "Remove even when active goals or tasks still reference it")
    .option("--actor <id>", "RBAC subject for domain pack management", "local-admin")
    .action(
      async (id: string, options: { cwd?: string; force?: boolean; actor: string }) => {
        await requireRbacPermission({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          actor: options.actor,
          permission: "domain.manage",
          action: "uninstall domain packs"
        });

        const { uninstallDomainPack } = await import("./domain-pack-install.js");
        const result = await uninstallDomainPack({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          id,
          force: options.force === true
        });

        console.log(`Uninstalled domain pack: ${result.id}`);
        console.log(`Destination: ${result.destination}`);
        console.log(`Active goals: ${result.activeGoals}`);
        console.log(`Active tasks: ${result.activeTasks}`);
      }
    );

  domain
    .command("upgrade")
    .description("Upgrade an installed domain pack from a validated ref.")
    .argument("<ref>", "Domain pack id or path")
    .option("--cwd <path>", "Workspace directory")
    .option("--root <path>", "Additional domain pack root", collectValues, [])
    .option("--no-built-ins", "Exclude built-in domain packs")
    .option("--force", "Upgrade even when active goals or tasks still reference it")
    .option("--actor <id>", "RBAC subject for domain pack management", "local-admin")
    .action(
      async (
        ref: string,
        options: {
          cwd?: string;
          root: string[];
          builtIns?: boolean;
          force?: boolean;
          actor: string;
        }
      ) => {
        await requireRbacPermission({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          actor: options.actor,
          permission: "domain.manage",
          action: "upgrade domain packs"
        });

        const { upgradeDomainPack } = await import("./domain-pack-install.js");
        const result = await upgradeDomainPack({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          ref,
          roots: options.root,
          includeBuiltIns: options.builtIns !== false,
          force: options.force === true
        });

        console.log(`Upgraded domain pack: ${result.id}`);
        console.log(
          `Version: ${result.previousManifest?.domain.version ?? "unknown"} -> ${result.manifest.domain.version}`
        );
        console.log(`Destination: ${result.destination}`);
        console.log(`Manifest: ${result.manifestPath}`);
        console.log(`Files: ${result.installedFiles.length}`);
        console.log(`Active goals: ${result.activeGoals}`);
        console.log(`Active tasks: ${result.activeTasks}`);
      }
    );

  domain
    .command("validate")
    .description("Validate a domain pack directory.")
    .argument("<path>", "Domain pack directory")
    .action(async (path: string) => {
      const { formatDomainPackValidationResult, validateDomainPackDir } =
        await import("@runstead/domain-packs");
      const result = await validateDomainPackDir(path);

      console.log(formatDomainPackValidationResult(result));
      if (!result.valid) {
        process.exitCode = 1;
      }
    });

  domain
    .command("manifest")
    .description("Build a deterministic domain pack manifest.")
    .argument("<path>", "Domain pack directory")
    .option("--output <path>", "Write manifest JSON to a file")
    .action(async (path: string, options: { output?: string }) => {
      const { buildDomainPackManifest } = await import("@runstead/domain-packs");
      const manifest = await buildDomainPackManifest(path);
      const contents = `${JSON.stringify(manifest, null, 2)}\n`;

      if (options.output === undefined) {
        process.stdout.write(contents);
        return;
      }

      const { writeFile } = await import("node:fs/promises");
      await writeFile(options.output, contents, "utf8");
      console.log(`Wrote domain pack manifest: ${options.output}`);
    });

  domain
    .command("verify-manifest")
    .description("Verify a domain pack against its stored runstead-manifest.json.")
    .argument("<path>", "Domain pack directory")
    .action(async (path: string) => {
      const { formatDomainPackManifestVerificationResult, verifyDomainPackManifest } =
        await import("@runstead/domain-packs");
      const result = await verifyDomainPackManifest(path);

      console.log(formatDomainPackManifestVerificationResult(result));
      if (!result.valid) {
        process.exitCode = 1;
      }
    });

  domain
    .command("pack")
    .description("Build a deterministic domain pack bundle.")
    .argument("<path>", "Domain pack directory")
    .requiredOption("--output <path>", "Write bundle JSON to a file")
    .action(async (path: string, options: { output: string }) => {
      const { buildDomainPackBundle, serializeDomainPackBundle } =
        await import("@runstead/domain-packs");
      const { writeFile } = await import("node:fs/promises");
      const bundle = await buildDomainPackBundle(path);

      await writeFile(options.output, serializeDomainPackBundle(bundle), "utf8");
      console.log(`Wrote domain pack bundle: ${options.output}`);
      console.log(
        `Domain: ${bundle.manifest.domain.id}@${bundle.manifest.domain.version}`
      );
      console.log(`Files: ${bundle.files.length}`);
    });

  domain
    .command("unpack")
    .description("Extract a deterministic domain pack bundle.")
    .argument("<bundle>", "Domain pack bundle JSON")
    .requiredOption("--output <path>", "Destination domain pack directory")
    .option("--force", "Overwrite existing extracted files")
    .action(
      async (bundlePath: string, options: { output: string; force?: boolean }) => {
        const { extractDomainPackBundle } = await import("@runstead/domain-packs");
        const { readFile } = await import("node:fs/promises");
        const bundle = JSON.parse(await readFile(bundlePath, "utf8")) as unknown;
        const result = await extractDomainPackBundle({
          bundle,
          outputDir: options.output,
          force: options.force === true
        });

        console.log(`Extracted domain pack bundle: ${result.outputDir}`);
        console.log(`Manifest: ${result.manifestPath}`);
        console.log(`Files: ${result.files.length}`);
      }
    );

  const goal = program.command("goal").description("Manage durable goals.");

  goal
    .command("create")
    .description("Create a goal from a domain pack template.")
    .argument("[domain]", "Domain pack id", "repo-maintenance")
    .option("--cwd <path>", "Workspace directory")
    .option("--template <id>", "Goal template id")
    .option("--title <title>", "Override goal title")
    .option("--repo <ref>", "Registered repository id, alias, or path")
    .option("--actor <id>", "RBAC subject for goal management", "local-admin")
    .action(
      async (
        domain: string,
        options: {
          cwd?: string;
          template?: string;
          title?: string;
          repo?: string;
          actor: string;
        }
      ) => {
        await requireRbacPermission({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          actor: options.actor,
          permission: "goal.manage",
          action: "manage goals"
        });

        const { createGoal } = await import("./goals.js");
        const result = await createGoal({
          domain,
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          ...(options.template === undefined ? {} : { template: options.template }),
          ...(options.title === undefined ? {} : { title: options.title }),
          ...(options.repo === undefined ? {} : { repository: options.repo })
        });

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
    .option("--actor <id>", "RBAC subject for goal access", "local-admin")
    .action(async (options: { cwd?: string; actor: string }) => {
      await requireRbacPermission({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        actor: options.actor,
        permission: "goal.read",
        action: "list goals"
      });

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
    .option("--actor <id>", "RBAC subject for goal access", "local-admin")
    .action(async (id: string, options: { cwd?: string; actor: string }) => {
      await requireRbacPermission({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        actor: options.actor,
        permission: "goal.read",
        action: "inspect goals"
      });

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
    .option("--actor <id>", "RBAC subject for task access", "local-admin")
    .action(async (options: { cwd?: string; goal?: string; actor: string }) => {
      await requireRbacPermission({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        actor: options.actor,
        permission: "task.read",
        action: "list tasks"
      });

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
    .option("--actor <id>", "RBAC subject for task access", "local-admin")
    .action(async (id: string, options: { cwd?: string; actor: string }) => {
      await requireRbacPermission({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        actor: options.actor,
        permission: "task.read",
        action: "inspect tasks"
      });

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

  const approval = program.command("approval").description("Manage approvals.");

  approval
    .command("list")
    .description("List approval requests.")
    .option("--cwd <path>", "Workspace directory")
    .option("--status <status>", "Filter by approval status")
    .option("--actor <id>", "RBAC subject for approval access", "local-admin")
    .action(async (options: { cwd?: string; status?: string; actor: string }) => {
      await requireRbacPermission({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        actor: options.actor,
        permission: "approval.read",
        action: "list approvals"
      });

      const { listApprovals } = await import("./approvals.js");
      const status = parseApprovalStatus(options.status);
      const result = listApprovals({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        ...(status === undefined ? {} : { status })
      });

      if (result.approvals.length === 0) {
        console.log("No approvals found.");
        return;
      }

      for (const item of result.approvals) {
        console.log(
          `${item.status.padEnd(8)} ${item.id} ${item.risk} ${item.actionId}: ${item.reason}`
        );
      }
    });

  approval
    .command("show")
    .description("Show an approval request.")
    .argument("<id>", "Approval id")
    .option("--cwd <path>", "Workspace directory")
    .option("--actor <id>", "RBAC subject for approval access", "local-admin")
    .action(async (id: string, options: { cwd?: string; actor: string }) => {
      await requireRbacPermission({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        actor: options.actor,
        permission: "approval.read",
        action: "inspect approvals"
      });

      const { showApproval } = await import("./approvals.js");
      const result = showApproval({ ...options, id });

      console.log(`Approval: ${result.approval.id}`);
      console.log(`Status: ${result.approval.status}`);
      console.log(`Risk: ${result.approval.risk}`);
      console.log(`Action: ${result.approval.actionId}`);
      console.log(`Policy decision: ${result.approval.policyDecisionId}`);
      console.log(`Reason: ${result.approval.reason}`);
      console.log(`Requested by: ${result.approval.requestedBy ?? "unknown"}`);
      console.log(`Expires: ${result.approval.expiresAt ?? "none"}`);
      console.log(`Decided by: ${result.approval.decidedBy ?? "none"}`);

      if (result.policyDecision !== undefined) {
        console.log(`Policy: ${result.policyDecision.policyId}`);
        console.log(
          `Policy fingerprint: ${approvalPolicyFingerprint(result.policyDecision.result)}`
        );
        console.log(
          `Action type: ${approvalActionField(
            result.policyDecision.action,
            "actionType"
          )}`
        );
        console.log(
          `Resource: ${approvalResourceSummary(result.policyDecision.action)}`
        );
        console.log(
          `Obligations: ${
            result.policyDecision.obligations.length === 0
              ? "none"
              : result.policyDecision.obligations.join(", ")
          }`
        );
      }
    });

  approval
    .command("approve")
    .description("Approve a pending approval request.")
    .argument("<id>", "Approval id")
    .option("--cwd <path>", "Workspace directory")
    .option("--actor <id>", "RBAC subject for approval decisions", "local-admin")
    .option("--decided-by <id>", "Approver id")
    .action(
      async (
        id: string,
        options: { cwd?: string; actor: string; decidedBy?: string }
      ) => {
        const actor = options.decidedBy ?? options.actor;
        const { decideApproval } = await import("./approvals.js");
        const result = await decideApproval({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          id,
          decision: "approved",
          decidedBy: actor
        });

        console.log(`Approved: ${result.approval.id}`);
      }
    );

  approval
    .command("deny")
    .description("Deny a pending approval request.")
    .argument("<id>", "Approval id")
    .option("--cwd <path>", "Workspace directory")
    .option("--actor <id>", "RBAC subject for approval decisions", "local-admin")
    .option("--decided-by <id>", "Approver id")
    .action(
      async (
        id: string,
        options: { cwd?: string; actor: string; decidedBy?: string }
      ) => {
        const actor = options.decidedBy ?? options.actor;
        const { decideApproval } = await import("./approvals.js");
        const result = await decideApproval({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          id,
          decision: "denied",
          decidedBy: actor
        });

        console.log(`Denied: ${result.approval.id}`);
      }
    );

  const verifier = program.command("verifier").description("Run verifiers.");

  verifier
    .command("run")
    .description("Run verifier commands for a task.")
    .argument("<task-id>", "Task id")
    .option("--cwd <path>", "Workspace directory")
    .option("--timeout-ms <ms>", "Per-command timeout in milliseconds")
    .option("--actor <id>", "RBAC subject for verifier execution", "local-admin")
    .action(
      async (
        taskId: string,
        options: { cwd?: string; timeoutMs?: string; actor: string }
      ) => {
        await requireRbacPermission({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          actor: options.actor,
          permission: "task.run",
          action: "run verifiers"
        });

        const { runTaskVerifiers } = await import("./verifier-runner.js");
        const timeoutMs =
          options.timeoutMs === undefined
            ? undefined
            : Number.parseInt(options.timeoutMs, 10);

        if (
          timeoutMs !== undefined &&
          (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
        ) {
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
      }
    );

  verifier
    .command("diff-scope")
    .description(
      "Verify changed files stay within the configured diff scope. Unmanaged helper; governed checks run through CI repair."
    )
    .option("--cwd <path>", "Workspace directory")
    .option("--base <ref>", "Base ref")
    .option("--head <ref>", "Head ref", "HEAD")
    .option("--allowed <pattern>", "Allowed path pattern", collectValues, [])
    .option("--denied <pattern>", "Denied path pattern", collectValues, [])
    .option("--actor <id>", "RBAC subject for verifier execution", "local-admin")
    .action(
      async (options: {
        cwd?: string;
        base?: string;
        head?: string;
        allowed: string[];
        denied: string[];
        actor: string;
      }) => {
        await requireRbacPermission({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          actor: options.actor,
          permission: "task.run",
          action: "run verifiers"
        });

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
  const githubApp = github
    .command("app")
    .description("Use GitHub App mode. Experimental.");
  const githubRun = github.command("run").description("Inspect GitHub workflow runs.");

  githubApp
    .command("init")
    .description("Configure GitHub App mode.")
    .requiredOption("--app-id <id>", "GitHub App id")
    .requiredOption("--private-key <path>", "GitHub App private key PEM path")
    .option("--cwd <path>", "Workspace directory")
    .option("--installation-id <id>", "GitHub App installation id")
    .option("--api-base-url <url>", "GitHub API base URL")
    .option("--force", "Overwrite an existing GitHub App config")
    .option("--actor <id>", "RBAC subject for GitHub App management", "local-admin")
    .action(
      async (options: {
        cwd?: string;
        appId: string;
        privateKey: string;
        installationId?: string;
        apiBaseUrl?: string;
        force?: boolean;
        actor: string;
      }) => {
        const { checkPermission } = await import("./rbac.js");
        const permission = await checkPermission({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          subject: options.actor,
          permission: "github_app.manage"
        });

        if (permission.decision !== "allow") {
          throw new Error(
            `Subject ${options.actor} cannot manage GitHub App mode: ${permission.reason}`
          );
        }

        const { initGitHubAppMode } = await import("./github-app.js");
        const result = await initGitHubAppMode({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          appId: options.appId,
          privateKeyPath: options.privateKey,
          ...(options.installationId === undefined
            ? {}
            : { installationId: options.installationId }),
          ...(options.apiBaseUrl === undefined
            ? {}
            : { apiBaseUrl: options.apiBaseUrl }),
          ...(options.force === undefined ? {} : { force: options.force })
        });

        console.log(
          `${result.overwritten ? "Overwrote" : "Configured"} GitHub App: ${result.path}`
        );
      }
    );

  githubApp
    .command("status")
    .description("Show GitHub App mode configuration.")
    .option("--cwd <path>", "Workspace directory")
    .option("--actor <id>", "RBAC subject for GitHub App management", "local-admin")
    .action(async (options: { cwd?: string; actor: string }) => {
      const { checkPermission } = await import("./rbac.js");
      const permission = await checkPermission({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        subject: options.actor,
        permission: "github_app.read"
      });

      if (permission.decision !== "allow") {
        throw new Error(
          `Subject ${options.actor} cannot inspect GitHub App mode: ${permission.reason}`
        );
      }

      const { formatGitHubAppConfigSummary, loadGitHubAppConfig } =
        await import("./github-app.js");
      const config = await loadGitHubAppConfig({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd })
      });

      console.log(formatGitHubAppConfigSummary(config));
    });

  githubApp
    .command("jwt")
    .description("Print a signed GitHub App JWT.")
    .option("--cwd <path>", "Workspace directory")
    .option("--actor <id>", "RBAC subject for GitHub App management", "local-admin")
    .option(
      "--print-secret",
      "Acknowledge that the GitHub App JWT will be printed to stdout"
    )
    .action(async (options: { cwd?: string; actor: string; printSecret?: boolean }) => {
      requireSecretPrintAcknowledgement(options, "GitHub App JWTs");
      const { checkPermission } = await import("./rbac.js");
      const permission = await checkPermission({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        subject: options.actor,
        permission: "github_app.manage"
      });

      if (permission.decision !== "allow") {
        throw new Error(
          `Subject ${options.actor} cannot sign GitHub App JWTs: ${permission.reason}`
        );
      }

      const { createGitHubAppJwtFromConfig } = await import("./github-app.js");
      const result = await createGitHubAppJwtFromConfig({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd })
      });

      console.log(result.token);
    });

  githubApp
    .command("token")
    .description("Print a GitHub App installation access token.")
    .option("--cwd <path>", "Workspace directory")
    .option("--installation-id <id>", "Override configured GitHub App installation id")
    .option("--actor <id>", "RBAC subject for GitHub App management", "local-admin")
    .option(
      "--print-secret",
      "Acknowledge that the installation access token will be printed to stdout"
    )
    .action(
      async (options: {
        cwd?: string;
        installationId?: string;
        actor: string;
        printSecret?: boolean;
      }) => {
        requireSecretPrintAcknowledgement(options, "GitHub App installation tokens");
        await requireRbacPermission({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          actor: options.actor,
          permission: "github_app.manage",
          action: "manage GitHub App mode"
        });

        const { createGitHubAppInstallationTokenFromConfig } =
          await import("./github-app.js");
        const result = await createGitHubAppInstallationTokenFromConfig({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          ...(options.installationId === undefined
            ? {}
            : { installationId: options.installationId })
        });

        console.log(result.token);
      }
    );

  githubRun
    .command("status")
    .description(
      "Show GitHub workflow run status. Unmanaged helper; governed reads run through CI repair intake."
    )
    .argument("<run-id>", "GitHub Actions workflow run id")
    .option("--cwd <path>", "Workspace directory")
    .option("--github-app", "Use configured GitHub App installation auth")
    .option("--installation-id <id>", "Override configured GitHub App installation id")
    .option("--actor <id>", "RBAC subject for GitHub run access", "local-admin")
    .action(
      async (
        runId: string,
        options: {
          cwd?: string;
          githubApp?: boolean;
          installationId?: string;
          actor: string;
        }
      ) => {
        await requireRbacPermission({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          actor: options.actor,
          permission: "repo.read",
          action: "inspect GitHub workflow runs"
        });

        const authToken = await resolveGitHubAuthToken(options);
        const { formatWorkflowRunStatus, getGitHubWorkflowRunStatus } =
          await import("./github-actions.js");
        const result = await getGitHubWorkflowRunStatus({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          runId,
          ...(authToken === undefined ? {} : { authToken })
        });

        console.log(formatWorkflowRunStatus(result));
      }
    );

  githubRun
    .command("logs")
    .description(
      "Print GitHub workflow run logs. Unmanaged helper; governed reads run through CI repair intake."
    )
    .argument("<run-id>", "GitHub Actions workflow run id")
    .option("--cwd <path>", "Workspace directory")
    .option("--github-app", "Use configured GitHub App installation auth")
    .option("--installation-id <id>", "Override configured GitHub App installation id")
    .option("--actor <id>", "RBAC subject for GitHub run access", "local-admin")
    .action(
      async (
        runId: string,
        options: {
          cwd?: string;
          githubApp?: boolean;
          installationId?: string;
          actor: string;
        }
      ) => {
        await requireRbacPermission({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          actor: options.actor,
          permission: "repo.read",
          action: "inspect GitHub workflow run logs"
        });

        const authToken = await resolveGitHubAuthToken(options);
        const { fetchGitHubWorkflowRunLog } = await import("./github-actions.js");
        const result = await fetchGitHubWorkflowRunLog({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          runId,
          ...(authToken === undefined ? {} : { authToken })
        });

        process.stdout.write(result.log);
      }
    );

  githubRun
    .command("repair")
    .description("Create a CI repair task from a failed GitHub workflow run.")
    .argument("<run-id>", "GitHub Actions workflow run id")
    .option("--cwd <path>", "Workspace directory")
    .option("--github-app", "Use configured GitHub App installation auth")
    .option("--installation-id <id>", "Override configured GitHub App installation id")
    .option("--actor <id>", "RBAC subject for repair task creation", "local-admin")
    .option(
      "--verifier <name=command>",
      "Verifier command to store on the CI repair task",
      collectValues,
      []
    )
    .action(
      async (
        runId: string,
        options: {
          cwd?: string;
          githubApp?: boolean;
          installationId?: string;
          actor: string;
          verifier: string[];
        }
      ) => {
        await requireRbacPermission({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          actor: options.actor,
          permission: "task.run",
          action: "create CI repair tasks"
        });

        const authToken = await resolveGitHubAuthToken(options);
        const { createCiRepairTaskFromWorkflowRun, formatCiRepairTaskReport } =
          await import("./ci-repair.js");
        const result = await createCiRepairTaskFromWorkflowRun({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          runId,
          ...(authToken === undefined ? {} : { authToken }),
          verifierCommands: options.verifier.map(parseVerifierCommandOption)
        });

        console.log(formatCiRepairTaskReport(result));
      }
    );

  addCiRepairOrchestrationCommand(
    githubRun
      .command("orchestrate-repair")
      .description("Run the CI repair branch, worker, verifier, and PR loop.")
  );

  const githubPr = github.command("pr").description("Create GitHub pull requests.");

  githubPr
    .command("create")
    .description(
      "Create a GitHub pull request with Runstead evidence. Unmanaged helper; governed PR creation runs through CI repair."
    )
    .requiredOption("--title <title>", "Pull request title")
    .requiredOption("--base <ref>", "Base branch")
    .requiredOption("--head <ref>", "Head branch")
    .option("--cwd <path>", "Workspace directory")
    .option("--body <body>", "Pull request body")
    .option("--draft", "Create a draft pull request")
    .option("--task <id>", "Runstead task id")
    .option("--goal <id>", "Runstead goal id")
    .option("--evidence <summary>", "Evidence summary", collectValues, [])
    .option("--github-app", "Use configured GitHub App installation auth")
    .option("--installation-id <id>", "Override configured GitHub App installation id")
    .option("--actor <id>", "RBAC subject for pull request creation", "local-admin")
    .option("--unmanaged", "Acknowledge this helper bypasses governed runtime")
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
        githubApp?: boolean;
        installationId?: string;
        actor: string;
        unmanaged?: boolean;
      }) => {
        requireUnmanagedHelperAcknowledgement(options, "create GitHub pull requests");
        await requireRbacPermission({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          actor: options.actor,
          permission: "repo.manage",
          action: "create GitHub pull requests"
        });

        const authToken = await resolveGitHubAuthToken(options);
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
          ...(authToken === undefined ? {} : { authToken }),
          evidence: evidenceSummariesFromCli(options.evidence)
        });

        console.log(`Created PR: ${result.url ?? result.stdout.trim()}`);
      }
    );

  const git = program.command("git").description("Git helpers for repo maintenance.");
  const gitBranch = git.command("branch").description("Manage Runstead git branches.");

  gitBranch
    .command("create")
    .description(
      "Create a git branch without overwriting existing branches. Unmanaged helper; governed branch creation runs through CI repair."
    )
    .argument("<branch-name>", "Branch name")
    .option("--cwd <path>", "Workspace directory")
    .option("--base <ref>", "Base ref")
    .option("--actor <id>", "RBAC subject for git branch management", "local-admin")
    .option("--unmanaged", "Acknowledge this helper bypasses governed runtime")
    .action(
      async (
        branchName: string,
        options: {
          cwd?: string;
          base?: string;
          actor: string;
          unmanaged?: boolean;
        }
      ) => {
        requireUnmanagedHelperAcknowledgement(options, "manage git branches");
        await requireRbacPermission({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          actor: options.actor,
          permission: "repo.manage",
          action: "manage git branches"
        });

        const { createGitBranch } = await import("./git-branch.js");
        const result = await createGitBranch({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          branchName,
          ...(options.base === undefined ? {} : { baseRef: options.base })
        });

        console.log(`Created branch: ${result.branchName}`);
      }
    );

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

interface CiRepairOrchestrationCliOptions {
  cwd?: string;
  worker: string;
  model?: string;
  base?: string;
  draft?: boolean;
  allowed: string[];
  denied: string[];
  githubApp?: boolean;
  installationId?: string;
  verifier: string[];
  actor: string;
}

interface CodexCliOptions {
  runsteadHome?: string;
}

interface CodexLoginCliOptions extends CodexCliOptions {
  baseUrl?: string;
  importCodexCli?: boolean;
  yes?: boolean;
}

interface CodexModelsCliOptions extends CodexCliOptions {
  refresh?: boolean;
}

interface AgentRunCliOptions {
  cwd?: string;
  worker: string;
  model?: string;
  mode: string;
  allowed: string[];
  denied: string[];
  verifier: string[];
  maxTurns?: string;
  actor: string;
}

interface AgentReportCliOptions {
  cwd?: string;
  actor: string;
}

function addCodexCommand(command: Command): void {
  command
    .command("login")
    .description("Authenticate the experimental Codex Direct provider.")
    .option("--runstead-home <path>", "Override RUNSTEAD_HOME for the auth store")
    .option("--base-url <url>", "Override the Codex backend base URL")
    .option(
      "--import-codex-cli",
      "Import an existing Codex CLI token once instead of starting device login"
    )
    .option("--yes", "Confirm explicit Codex CLI token import")
    .action(async (options: CodexLoginCliOptions) => {
      const {
        importCodexCliTokens,
        loginCodexWithDeviceCode,
        formatCodexAuthStatus,
        getCodexAuthStatus
      } = await import("./codex-auth.js");

      if (options.importCodexCli === true) {
        if (options.yes !== true) {
          throw new Error(
            "--import-codex-cli requires --yes because Codex refresh tokens are single-use across clients"
          );
        }

        const imported = await importCodexCliTokens({
          ...(options.runsteadHome === undefined
            ? {}
            : { runsteadHome: options.runsteadHome }),
          ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl })
        });

        if (imported === undefined) {
          throw new Error("No valid Codex CLI credentials found to import");
        }

        console.log(`Imported Codex credentials into ${imported.authPath}`);
        console.log(
          formatCodexAuthStatus(
            await getCodexAuthStatus({
              ...(options.runsteadHome === undefined
                ? {}
                : { runsteadHome: options.runsteadHome })
            })
          )
        );
        return;
      }

      const result = await loginCodexWithDeviceCode({
        ...(options.runsteadHome === undefined
          ? {}
          : { runsteadHome: options.runsteadHome }),
        ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
        onDeviceCode: (deviceCode) => {
          console.log("To continue, open this URL in your browser:");
          console.log(`  ${deviceCode.verificationUrl}`);
          console.log("Then enter this code:");
          console.log(`  ${deviceCode.userCode}`);
          console.log("Waiting for sign-in...");
        }
      });

      console.log(`Saved Codex credentials to ${result.authPath}`);
    });

  command
    .command("status")
    .description("Show Codex Direct authentication status without printing tokens.")
    .option("--runstead-home <path>", "Override RUNSTEAD_HOME for the auth store")
    .action(async (options: CodexCliOptions) => {
      const { formatCodexAuthStatus, getCodexAuthStatus } =
        await import("./codex-auth.js");

      console.log(
        formatCodexAuthStatus(
          await getCodexAuthStatus({
            ...(options.runsteadHome === undefined
              ? {}
              : { runsteadHome: options.runsteadHome })
          })
        )
      );
    });

  command
    .command("logout")
    .description("Clear Codex Direct credentials from the Runstead auth store.")
    .option("--runstead-home <path>", "Override RUNSTEAD_HOME for the auth store")
    .action(async (options: CodexCliOptions) => {
      const { clearCodexAuthState } = await import("./codex-auth.js");
      const result = await clearCodexAuthState({
        ...(options.runsteadHome === undefined
          ? {}
          : { runsteadHome: options.runsteadHome })
      });

      console.log(
        result.cleared
          ? `Cleared Codex credentials from ${result.authPath}`
          : `No Codex credentials were stored at ${result.authPath}`
      );
    });

  command
    .command("models")
    .description("List models available to the Codex Direct provider.")
    .option("--runstead-home <path>", "Override RUNSTEAD_HOME for the auth store")
    .option("--refresh", "Force an access-token refresh before listing models")
    .action(async (options: CodexModelsCliOptions) => {
      const { formatCodexModels, listCodexModels } = await import("./codex-auth.js");
      const models = await listCodexModels({
        ...(options.runsteadHome === undefined
          ? {}
          : { runsteadHome: options.runsteadHome }),
        forceRefresh: options.refresh === true
      });

      console.log(formatCodexModels(models));
    });
}

function addAgentCommand(command: Command): void {
  command
    .command("run")
    .description("Run a governed local agent task against the current workspace.")
    .argument("<prompt...>", "Task prompt for the local agent")
    .option("--cwd <path>", "Workspace directory")
    .option("--worker <worker>", "Worker to run: codex_direct", "codex_direct")
    .option("--model <model>", "Model to use with codex_direct")
    .option("--mode <mode>", "Agent mode: read-only, edit, or repair", "read-only")
    .option("--allowed <pattern>", "Allowed workspace path pattern", collectValues, [])
    .option("--denied <pattern>", "Denied workspace path pattern", collectValues, [])
    .option("--verifier <name=command>", "Verifier command for edit/repair tasks", collectValues, [])
    .option("--max-turns <number>", "Maximum Codex Direct tool turns")
    .option("--actor <id>", "RBAC subject for local agent execution", "local-admin")
    .action(async (promptParts: string[], options: AgentRunCliOptions) => {
      await requireRbacPermission({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        actor: options.actor,
        permission: "task.run",
        action: "run local agent tasks"
      });

      const worker = parseCiRepairWorkerKind(options.worker);

      if (worker !== "codex_direct") {
        throw new Error("agent run currently supports --worker codex_direct only");
      }

      const {
        createLocalAgentTask,
        formatLocalAgentRunReport,
        localAgentRunExitCode,
        runLocalAgentTask
      } = await import("./local-agent.js");
      const created = await createLocalAgentTask({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        prompt: promptParts.join(" "),
        worker,
        ...(options.model === undefined ? {} : { model: options.model }),
        mode: parseLocalAgentMode(options.mode),
        allowedPaths: options.allowed,
        deniedPaths: options.denied,
        verifierCommands: options.verifier.map(parseVerifierCommandOption),
        ...(options.maxTurns === undefined
          ? {}
          : { maxTurns: parseRequiredInteger(options.maxTurns, "--max-turns") })
      });
      const result = await runLocalAgentTask({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        taskId: created.task.id
      });
      const exitCode = localAgentRunExitCode(result);

      console.log(formatLocalAgentRunReport(result));
      if (exitCode !== 0) {
        process.exitCode = exitCode;
      }
    });

  command
    .command("report")
    .description("Summarize a local agent task and its audit trail.")
    .argument("<task-id>", "Local agent task id")
    .option("--cwd <path>", "Workspace directory")
    .option("--actor <id>", "RBAC subject for local agent reporting", "local-admin")
    .action(async (taskId: string, options: AgentReportCliOptions) => {
      await requireRbacPermission({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        actor: options.actor,
        permission: "audit.read",
        action: "read local agent reports"
      });

      const { formatLocalAgentTaskReport, loadLocalAgentTaskReport } =
        await import("./local-agent.js");
      const report = await loadLocalAgentTaskReport({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        taskId
      });

      console.log(formatLocalAgentTaskReport(report));
    });

  command
    .command("resume")
    .description("Resume a queued local agent task after an approval decision.")
    .argument("<task-id>", "Local agent task id")
    .option("--cwd <path>", "Workspace directory")
    .option("--actor <id>", "RBAC subject for local agent execution", "local-admin")
    .action(async (taskId: string, options: AgentReportCliOptions) => {
      await requireRbacPermission({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        actor: options.actor,
        permission: "task.run",
        action: "resume local agent tasks"
      });

      const { formatLocalAgentRunReport, localAgentRunExitCode, runLocalAgentTask } =
        await import("./local-agent.js");
      const result = await runLocalAgentTask({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        taskId
      });
      const exitCode = localAgentRunExitCode(result);

      console.log(formatLocalAgentRunReport(result));
      if (exitCode !== 0) {
        process.exitCode = exitCode;
      }
    });
}

function addCiRepairOrchestrationCommand(command: Command): void {
  command
    .argument("<run-id>", "GitHub Actions workflow run id")
    .option("--cwd <path>", "Workspace directory")
    .option(
      "--worker <worker>",
      "Worker to run: codex_cli, claude_code, or codex_direct",
      "codex_cli"
    )
    .option("--model <model>", "Model to use with codex_direct")
    .option("--base <ref>", "PR base branch")
    .option("--draft", "Create a draft pull request")
    .option("--allowed <pattern>", "Allowed changed path pattern", collectValues, [])
    .option("--denied <pattern>", "Denied changed path pattern", collectValues, [])
    .option("--github-app", "Use configured GitHub App installation auth")
    .option("--installation-id <id>", "Override configured GitHub App installation id")
    .option("--actor <id>", "RBAC subject for repair orchestration", "local-admin")
    .requiredOption(
      "--verifier <name=command>",
      "Verifier command to run after repair",
      collectValues,
      []
    )
    .action(async (runId: string, options: CiRepairOrchestrationCliOptions) => {
      await runCiRepairOrchestrationFromCli(runId, options);
    });
}

async function runCiRepairOrchestrationFromCli(
  runId: string,
  options: CiRepairOrchestrationCliOptions
): Promise<void> {
  await requireRbacPermission({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    actor: options.actor,
    permission: "task.run",
    action: "orchestrate CI repair"
  });

  const authToken = await resolveGitHubAuthToken(options);
  const { formatCiRepairOrchestratorReport, runCiRepairOrchestrator } =
    await import("./ci-repair-orchestrator.js");
  const result = await runCiRepairOrchestrator({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    runId,
    worker: parseCiRepairWorkerKind(options.worker),
    ...(options.model === undefined ? {} : { model: options.model }),
    ...(options.base === undefined ? {} : { base: options.base }),
    draft: options.draft === true,
    allowedPaths: options.allowed,
    deniedPaths: options.denied,
    ...(authToken === undefined ? {} : { authToken }),
    verifierCommands: options.verifier.map(parseVerifierCommandOption)
  });

  console.log(formatCiRepairOrchestratorReport(result));
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

function parseCiRepairWorkerKind(
  value: string
): "codex_cli" | "claude_code" | "codex_direct" {
  if (value === "codex_cli" || value === "claude_code" || value === "codex_direct") {
    return value;
  }

  throw new Error("--worker must be codex_cli, claude_code, or codex_direct");
}

function parseLocalAgentMode(value: string): "read-only" | "edit" | "repair" {
  if (value === "read-only" || value === "edit" || value === "repair") {
    return value;
  }

  throw new Error("--mode must be read-only, edit, or repair");
}

function parseVerifierCommandOption(value: string): { name: string; command: string } {
  const separator = value.indexOf("=");

  if (separator <= 0 || separator === value.length - 1) {
    throw new Error("--verifier must use name=command");
  }

  return {
    name: value.slice(0, separator).trim(),
    command: value.slice(separator + 1).trim()
  };
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

function parseRequiredInteger(value: string, optionName: string): number {
  const parsed = parseOptionalInteger(value, optionName);

  if (parsed === undefined) {
    throw new Error(`${optionName} is required`);
  }

  return parsed;
}

async function requireRbacPermission(options: {
  cwd?: string;
  actor: string;
  permission: string;
  action: string;
}): Promise<void> {
  const { checkPermission } = await import("./rbac.js");
  const result = await checkPermission({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    subject: options.actor,
    permission: options.permission
  });

  if (result.decision !== "allow") {
    throw new Error(
      `Subject ${options.actor} cannot ${options.action}: ${result.reason}`
    );
  }
}

export function requireUnmanagedHelperAcknowledgement(
  options: { unmanaged?: boolean },
  action: string
): void {
  if (options.unmanaged !== true) {
    throw new Error(
      `Refusing to ${action} through an unmanaged helper. Use the governed runtime, or pass --unmanaged to acknowledge this bypass.`
    );
  }
}

export function requireSecretPrintAcknowledgement(
  options: { printSecret?: boolean },
  secretName: string
): void {
  if (options.printSecret !== true) {
    throw new Error(
      `Refusing to print ${secretName}. Pass --print-secret to acknowledge stdout will contain a credential.`
    );
  }
}

async function resolveGitHubAuthToken(options: {
  cwd?: string;
  githubApp?: boolean;
  installationId?: string;
}): Promise<string | undefined> {
  if (options.githubApp !== true) {
    return undefined;
  }

  const { createGitHubAppInstallationTokenFromConfig } =
    await import("./github-app.js");
  const result = await createGitHubAppInstallationTokenFromConfig({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    ...(options.installationId === undefined
      ? {}
      : { installationId: options.installationId })
  });

  return result.token;
}

function parseDateOption(value: string, optionName: string): Date {
  const parsed = new Date(value);

  if (!Number.isFinite(parsed.getTime())) {
    throw new Error(`${optionName} must be a valid date`);
  }

  return parsed;
}

function parseCommaSeparatedList(value: string | undefined): string[] {
  if (value === undefined) {
    return [];
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseRepositoryStatus(
  value: string | undefined
): "active" | "archived" | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === "active" || value === "archived") {
    return value;
  }

  throw new Error("--status must be active or archived");
}

function parseApprovalStatus(
  value: string | undefined
): "pending" | "approved" | "denied" | "expired" | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (
    value === "pending" ||
    value === "approved" ||
    value === "denied" ||
    value === "expired"
  ) {
    return value;
  }

  throw new Error("--status must be pending, approved, denied, or expired");
}

function approvalPolicyFingerprint(result: unknown): string {
  if (!isRecord(result)) {
    return "unknown";
  }

  return typeof result.policyFingerprint === "string"
    ? result.policyFingerprint
    : "unknown";
}

function approvalActionField(action: unknown, field: string): string {
  if (!isRecord(action)) {
    return "unknown";
  }

  const value = action[field];
  return typeof value === "string" ? value : "unknown";
}

function approvalResourceSummary(action: unknown): string {
  if (!isRecord(action) || !isRecord(action.resource)) {
    return "unknown";
  }

  const type =
    typeof action.resource.type === "string" ? action.resource.type : "unknown";
  const identifier =
    typeof action.resource.id === "string"
      ? action.resource.id
      : typeof action.resource.path === "string"
        ? action.resource.path
        : undefined;

  return identifier === undefined ? type : `${type}:${identifier}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const entrypoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : undefined;

if (entrypoint === import.meta.url) {
  await createProgram({
    ...(process.argv[1] === undefined ? {} : { entrypoint: process.argv[1] })
  }).parseAsync(process.argv);
}
