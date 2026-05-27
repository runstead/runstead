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
        refreshPlanConnector(
          parseStartupSourceConnector(connector),
          requirement.collectCommands[index]
        )
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

function refreshPlanConnector(
  connector: StartupSourceConnector,
  collectCommand: string | undefined
): StartupSourceRefreshPlanConnector {
  const definition = getStartupSourceConnectorDefinition(connector);
  const adapter = getStartupSourceProviderAdapter(connector);

  if (definition === undefined) {
    throw new Error(`Startup source connector definition not found: ${connector}`);
  }

  return {
    connector,
    displayName: definition.displayName,
    ...(adapter?.provider === undefined ? {} : { adapterProvider: adapter.provider }),
    ...(adapter?.requiredTokenEnv === undefined
      ? {}
      : { requiredTokenEnv: adapter.requiredTokenEnv }),
    defaultFreshnessDays: definition.defaultFreshnessDays,
    collectCommand:
      collectCommand ??
      `runstead startup source collect --connector ${connector} --target <target> --source-uri <provider-api-url>`
  };
}
