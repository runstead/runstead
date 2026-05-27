import { requireRbacPermission } from "../cli-rbac.js";
import { parseStartupGateStage } from "../startup-command-parsers.js";

export {
  runStartupGateDecideCommand,
  runStartupGateWaiveCommand
} from "./startup-gate-decision-actions.js";
export type {
  StartupGateDecideCommandOptions,
  StartupGateWaiveCommandOptions
} from "./startup-gate-decision-actions.js";

export interface StartupGateCheckCommandOptions {
  cwd?: string;
  stage: string;
  domain: string;
  actor: string;
}

export interface StartupGateFixtureTestCommandOptions {
  json?: boolean;
}

export async function runStartupGateCheckCommand(
  options: StartupGateCheckCommandOptions
): Promise<void> {
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

export async function runStartupGateFixtureTestCommand(
  fixture: string,
  options: StartupGateFixtureTestCommandOptions
): Promise<void> {
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
}
