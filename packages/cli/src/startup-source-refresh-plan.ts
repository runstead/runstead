import {
  getStartupSourceConnectorDefinition,
  getStartupSourceProviderAdapter,
  parseStartupSourceConnector,
  parseStartupSourceTarget,
  type StartupSourceConnector,
  type StartupSourceTarget
} from "./startup-source-connector-definitions.js";
import { startupSourceConnectorRequirementsForTarget } from "./startup-source-readiness-requirements.js";

export interface StartupSourceRefreshPlanOptions {
  cwd?: string;
  target: string;
  env?: Record<string, string | undefined>;
}

export interface StartupSourceRefreshPlan {
  target: StartupSourceTarget;
  blockers: string[];
  requirements: StartupSourceRefreshPlanRequirement[];
}

export interface StartupSourceRefreshPlanRequirement {
  id: string;
  title: string;
  target: StartupSourceTarget;
  evidenceTiers: string[];
  evidenceTypes: string[];
  missingTokenEnv: string[];
  blockers: string[];
  connectors: StartupSourceRefreshPlanConnector[];
}

export interface StartupSourceRefreshPlanConnector {
  connector: StartupSourceConnector;
  displayName: string;
  adapterProvider?: string;
  requiredTokenEnv?: string;
  defaultFreshnessDays: number;
  collectCommand: string;
}

export function createStartupSourceRefreshPlan(
  options: StartupSourceRefreshPlanOptions
): StartupSourceRefreshPlan {
  const target = parseStartupSourceTarget(options.target);
  const requirements = startupSourceConnectorRequirementsForTarget({
    target,
    env: options.env ?? process.env
  });

  return {
    target,
    blockers: requirements.flatMap((requirement) => requirement.blockers),
    requirements: requirements.map((requirement) => ({
      id: requirement.id,
      title: requirement.title,
      target: requirement.target,
      evidenceTiers: [...requirement.evidenceTiers],
      evidenceTypes: [...requirement.evidenceTypes],
      missingTokenEnv: [...requirement.missingTokenEnv],
      blockers: [...requirement.blockers],
      connectors: requirement.connectors.map((connector, index) =>
        refreshPlanConnector({
          connector: parseStartupSourceConnector(connector),
          collectCommand: requirement.collectCommands[index],
          ...(options.cwd === undefined ? {} : { cwd: options.cwd })
        })
      )
    }))
  };
}

export function formatStartupSourceRefreshPlan(plan: StartupSourceRefreshPlan): string {
  if (plan.requirements.length === 0) {
    return `Startup source refresh plan: ${plan.target}\nNo external source refresh required for local readiness.`;
  }

  const lines = [
    `Startup source refresh plan: ${plan.target}`,
    `Blockers: ${plan.blockers.length}`,
    ""
  ];

  for (const requirement of plan.requirements) {
    lines.push(`${requirement.id}: ${requirement.title}`);
    lines.push(`  evidence tiers: ${requirement.evidenceTiers.join(",") || "none"}`);
    lines.push(`  evidence types: ${requirement.evidenceTypes.join(",") || "none"}`);

    if (requirement.missingTokenEnv.length > 0) {
      lines.push(`  missing env: ${requirement.missingTokenEnv.join(",")}`);
    }

    for (const connector of requirement.connectors) {
      lines.push(
        `  - ${connector.connector}: freshness=${connector.defaultFreshnessDays}d adapter=${connector.adapterProvider ?? "none"}`
      );
      lines.push(`    command: ${connector.collectCommand}`);
    }

    for (const blocker of requirement.blockers) {
      lines.push(`    blocker: ${blocker}`);
    }

    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

function refreshPlanConnector(input: {
  connector: StartupSourceConnector;
  collectCommand: string | undefined;
  cwd?: string;
}): StartupSourceRefreshPlanConnector {
  const definition = getStartupSourceConnectorDefinition(input.connector);
  const adapter = getStartupSourceProviderAdapter(input.connector);

  if (definition === undefined) {
    throw new Error(
      `Startup source connector definition not found: ${input.connector}`
    );
  }

  return {
    connector: input.connector,
    displayName: definition.displayName,
    ...(adapter?.provider === undefined ? {} : { adapterProvider: adapter.provider }),
    ...(adapter?.requiredTokenEnv === undefined
      ? {}
      : { requiredTokenEnv: adapter.requiredTokenEnv }),
    defaultFreshnessDays: definition.defaultFreshnessDays,
    collectCommand: sourceCollectCommand({
      connector: input.connector,
      collectCommand: input.collectCommand,
      ...(input.cwd === undefined ? {} : { cwd: input.cwd })
    })
  };
}

function sourceCollectCommand(input: {
  connector: StartupSourceConnector;
  collectCommand: string | undefined;
  cwd?: string;
}): string {
  const command =
    input.collectCommand ??
    `runstead startup source collect --connector ${input.connector} --target <target> --source-uri <provider-api-url>`;

  if (input.cwd === undefined) {
    return command;
  }

  return command.replace(
    /^runstead startup source collect\b/u,
    `runstead startup source collect --cwd ${shellQuote(input.cwd)}`
  );
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:@=-]+$/.test(value)) {
    return value;
  }

  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}
