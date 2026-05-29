import type {
  ReadinessEvidenceRequirement,
  ReadinessEvidenceTier,
  ReadinessTarget
} from "./readiness-plan.js";

export interface RuntimeStartupSourceConnectorReadinessRequirement {
  id: string;
  title: string;
  target: ReadinessTarget;
  connectors: string[];
  evidenceTiers: ReadinessEvidenceTier[];
  evidenceTypes: string[];
  requiredTokenEnv: string[];
  missingTokenEnv: string[];
  blockers: string[];
  collectCommands: string[];
}

export function runtimeStartupSourceConnectorRequirementsForTarget(options: {
  target: ReadinessTarget;
  env?: Record<string, string | undefined>;
}): RuntimeStartupSourceConnectorReadinessRequirement[] {
  if (options.target === "local") {
    return [];
  }

  const env = options.env ?? {};

  return [
    runtimeSourceConnectorRequirement({
      id: "remote-ci",
      title: "Remote CI status",
      target: options.target,
      connectors: ["github_actions", "gitlab_ci"],
      evidenceTiers: ["ci_verified"],
      evidenceTypes: ["startup_repo_readiness"],
      requiredTokenEnv: ["GITHUB_TOKEN", "GITLAB_TOKEN"],
      tokenMode: "any",
      env
    }),
    runtimeSourceConnectorRequirement({
      id: "deployment-provider",
      title: `${options.target} deployment provider`,
      target: options.target,
      connectors: ["vercel", "render"],
      evidenceTiers: [
        options.target === "staging" ? "staging_deployment" : "production_deployment"
      ],
      evidenceTypes: ["startup_release_plan"],
      requiredTokenEnv: ["VERCEL_TOKEN", "RENDER_API_KEY"],
      tokenMode: "any",
      env
    }),
    runtimeSourceConnectorRequirement({
      id: "monitoring-provider",
      title: "Monitoring provider",
      target: options.target,
      connectors: ["sentry"],
      evidenceTiers: [],
      evidenceTypes: ["startup_monitoring_alerts"],
      requiredTokenEnv: ["SENTRY_AUTH_TOKEN"],
      env
    }),
    ...(options.target === "production"
      ? [
          runtimeSourceConnectorRequirement({
            id: "analytics-provider",
            title: "Real-user analytics provider",
            target: options.target,
            connectors: ["posthog"],
            evidenceTiers: ["real_user_analytics"],
            evidenceTypes: ["startup_metric_snapshot"],
            requiredTokenEnv: ["POSTHOG_API_KEY"],
            env
          })
        ]
      : [])
  ];
}

export function runtimeStartupSourceConnectorReadinessEvidenceRequirements(
  requirements: RuntimeStartupSourceConnectorReadinessRequirement[]
): ReadinessEvidenceRequirement[] {
  return requirements.map((requirement) => ({
    source: "startup_source",
    sourceId: requirement.id,
    targets: [requirement.target],
    evidenceTiers: [...requirement.evidenceTiers],
    evidenceTypes: [...requirement.evidenceTypes],
    ...(requirement.blockers.length === 0
      ? {}
      : { blockers: [...requirement.blockers] })
  }));
}

export function runtimeStartupSourceConnectorRequirementBlockers(
  requirements: RuntimeStartupSourceConnectorReadinessRequirement[]
): string[] {
  return requirements.flatMap((requirement) => requirement.blockers);
}

function runtimeSourceConnectorRequirement(input: {
  id: string;
  title: string;
  target: ReadinessTarget;
  connectors: string[];
  evidenceTiers: ReadinessEvidenceTier[];
  evidenceTypes: string[];
  requiredTokenEnv: string[];
  tokenMode?: "all" | "any";
  env: Record<string, string | undefined>;
}): RuntimeStartupSourceConnectorReadinessRequirement {
  const tokenMode = input.tokenMode ?? "all";
  const missingTokenEnv =
    tokenMode === "any"
      ? input.requiredTokenEnv.some((name) => envValuePresent(input.env, name))
        ? []
        : [...input.requiredTokenEnv]
      : input.requiredTokenEnv.filter((name) => !envValuePresent(input.env, name));
  const tokenDescription =
    tokenMode === "any"
      ? `one of ${input.requiredTokenEnv.join(", ")}`
      : input.requiredTokenEnv.join(", ");
  const blockers =
    missingTokenEnv.length === 0
      ? []
      : [
          `${input.title} connector requires ${tokenDescription} for ${input.target} readiness`
        ];

  return {
    id: input.id,
    title: input.title,
    target: input.target,
    connectors: [...input.connectors],
    evidenceTiers: [...input.evidenceTiers],
    evidenceTypes: [...input.evidenceTypes],
    requiredTokenEnv: [...input.requiredTokenEnv],
    missingTokenEnv,
    blockers,
    collectCommands: input.connectors.map(
      (connector) =>
        `runstead startup source collect --connector ${connector} --target ${input.target} --source-uri <provider-api-url>`
    )
  };
}

function envValuePresent(
  env: Record<string, string | undefined>,
  name: string
): boolean {
  return env[name] !== undefined && env[name]?.trim() !== "";
}
