import type { Command } from "commander";

import { requireRbacPermission } from "../cli-rbac.js";
import {
  parseStartupGateDecision,
  parseStartupGateStage
} from "../startup-command-parsers.js";

export function registerStartupGateCommand(startup: Command): Command {
  const startupGate = startup
    .command("gate")
    .description("Check startup stage gates against Runstead evidence.");

  startupGate
    .command("check")
    .description("Check whether a startup stage gate passes.")
    .option("--cwd <path>", "Workspace directory")
    .option("--stage <stage>", "Stage to check: idea, mvp, launch, or scale", "launch")
    .option("--domain <id>", "Domain id to evaluate", "ai-native-startup")
    .option("--actor <id>", "RBAC subject for gate checks", "local-admin")
    .action(
      async (options: {
        cwd?: string;
        stage: string;
        domain: string;
        actor: string;
      }) => {
        await requireRbacPermission({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          actor: options.actor,
          permission: "evidence.read",
          action: "check startup gates"
        });

        const { checkStartupGate, formatStartupGateCheckResult } =
          await import("../startup-evidence.js");
        const result = await checkStartupGate({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          domain: options.domain,
          stage: parseStartupGateStage(options.stage)
        });

        console.log(formatStartupGateCheckResult(result));

        if (!result.passed) {
          process.exitCode = 1;
        }
      }
    );

  startupGate
    .command("test")
    .description(
      "Replay startup gate fixture files against the readiness verdict engine."
    )
    .argument("<fixture>", "Startup gate fixture file or directory")
    .option("--json", "Print JSON output")
    .action(async (fixture: string, options: { json?: boolean }) => {
      const { formatStartupGateFixtureTestSummary, testStartupGateFixtures } =
        await import("../startup-gate-test.js");
      const result = await testStartupGateFixtures({ fixturePath: fixture });

      if (options.json === true) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(formatStartupGateFixtureTestSummary(result));
      }

      if (result.failed > 0) {
        process.exitCode = 1;
      }
    });

  startupGate
    .command("waive")
    .description(
      "Record a time-boxed owner-approved waiver for a startup gate blocker."
    )
    .option("--cwd <path>", "Workspace directory")
    .option("--stage <stage>", "Stage to waive: idea, mvp, launch, or scale", "launch")
    .option("--domain <id>", "Domain id to evaluate", "ai-native-startup")
    .requiredOption("--blocker <text>", "Exact blocker text to waive")
    .requiredOption("--owner <id>", "Owner accepting the waived risk")
    .requiredOption("--reason <text>", "Reason the blocker can be accepted")
    .option("--comment <text>", "Reviewer or approver comment")
    .requiredOption("--expires-at <iso>", "Expiration timestamp for the waiver")
    .option("--actor <id>", "RBAC subject for gate decisions", "local-admin")
    .action(
      async (options: {
        cwd?: string;
        stage: string;
        domain: string;
        blocker: string;
        owner: string;
        reason: string;
        comment?: string;
        expiresAt: string;
        actor: string;
      }) => {
        await requireRbacPermission({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          actor: options.actor,
          permission: "evidence.write",
          action: "record startup gate waiver"
        });

        const { recordStartupGateDecision } = await import("../startup-evidence.js");
        const result = await recordStartupGateDecision({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          domain: options.domain,
          stage: parseStartupGateStage(options.stage),
          decision: "waive_blocker",
          blocker: options.blocker,
          owner: options.owner,
          reason: options.reason,
          ...(options.comment === undefined ? {} : { comment: options.comment }),
          expiresAt: options.expiresAt
        });

        console.log(`Recorded gate waiver: ${result.evidence.id}`);
        console.log(`Artifact: ${result.artifactPath}`);
      }
    );

  startupGate
    .command("decide")
    .description("Record a launch/no-launch decision for a startup gate.")
    .option("--cwd <path>", "Workspace directory")
    .option("--stage <stage>", "Stage to decide: idea, mvp, launch, or scale", "launch")
    .option("--domain <id>", "Domain id to evaluate", "ai-native-startup")
    .requiredOption(
      "--decision <value>",
      "Decision: launch, no_launch, or launch_with_accepted_debt"
    )
    .requiredOption("--reason <text>", "Decision rationale")
    .option("--owner <id>", "Decision owner")
    .option("--comment <text>", "Reviewer or approver comment")
    .option("--actor <id>", "RBAC subject for gate decisions", "local-admin")
    .action(
      async (options: {
        cwd?: string;
        stage: string;
        domain: string;
        decision: string;
        reason: string;
        owner?: string;
        comment?: string;
        actor: string;
      }) => {
        await requireRbacPermission({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          actor: options.actor,
          permission: "evidence.write",
          action: "record startup gate decision"
        });

        const { recordStartupGateDecision } = await import("../startup-evidence.js");
        const result = await recordStartupGateDecision({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          domain: options.domain,
          stage: parseStartupGateStage(options.stage),
          decision: parseStartupGateDecision(options.decision),
          reason: options.reason,
          ...(options.comment === undefined ? {} : { comment: options.comment }),
          ...(options.owner === undefined ? {} : { owner: options.owner })
        });

        console.log(`Recorded gate decision: ${result.evidence.id}`);
        console.log(`Artifact: ${result.artifactPath}`);
      }
    );

  return startupGate;
}
