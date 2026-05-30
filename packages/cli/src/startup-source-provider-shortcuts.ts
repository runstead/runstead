import {
  parseStartupSourceConnector,
  type StartupSourceConnector
} from "./startup-source-connector-definitions.js";

export type StartupSourceCollectProviderShortcut =
  | "github_actions"
  | "vercel"
  | "sentry"
  | "posthog";

export interface StartupSourceCollectShortcutOptions {
  connector?: string;
  sourceUri?: string;
  githubRepo?: string;
  githubRunId?: string;
  vercelDeployment?: string;
  vercelTeam?: string;
  sentryOrg?: string;
  sentryRelease?: string;
  sentryProjectId?: string;
  posthogEnvironment?: string;
  posthogProject?: string;
  posthogInsight?: string;
  posthogHost?: string;
}

export interface StartupSourceResolvedCollectSource {
  connector: StartupSourceConnector;
  sourceUri: string;
  shortcut?: StartupSourceCollectProviderShortcut;
}

interface ShortcutFamily {
  shortcut: StartupSourceCollectProviderShortcut;
  values: (string | undefined)[];
}

export function resolveStartupSourceCollectSource(
  options: StartupSourceCollectShortcutOptions
): StartupSourceResolvedCollectSource {
  const activeShortcuts = collectActiveShortcuts(options);
  const sourceUri = normalizeOptional(options.sourceUri);

  if (sourceUri !== undefined && activeShortcuts.length > 0) {
    throw new Error("--source-uri cannot be combined with provider shortcut options");
  }

  if (activeShortcuts.length > 1) {
    throw new Error(
      `Provider shortcut options are mutually exclusive: ${activeShortcuts
        .map((shortcut) => shortcut.shortcut)
        .join(", ")}`
    );
  }

  if (activeShortcuts.length === 0) {
    return {
      connector: parseRequiredConnector(options.connector),
      sourceUri: requireValue(sourceUri, "--source-uri")
    };
  }

  const shortcut = activeShortcuts[0]?.shortcut;

  if (shortcut === undefined) {
    throw new Error("Provider shortcut resolution failed");
  }

  const connector = parseShortcutConnector(options.connector, shortcut);

  switch (shortcut) {
    case "github_actions":
      return {
        connector,
        shortcut,
        sourceUri: githubActionsSourceUri({
          repo: options.githubRepo,
          runId: options.githubRunId
        })
      };
    case "vercel":
      return {
        connector,
        shortcut,
        sourceUri: vercelSourceUri({
          deployment: options.vercelDeployment,
          team: options.vercelTeam
        })
      };
    case "sentry":
      return {
        connector,
        shortcut,
        sourceUri: sentrySourceUri({
          org: options.sentryOrg,
          release: options.sentryRelease,
          projectId: options.sentryProjectId
        })
      };
    case "posthog":
      return {
        connector,
        shortcut,
        sourceUri: posthogSourceUri({
          environment: options.posthogEnvironment ?? options.posthogProject,
          insight: options.posthogInsight,
          host: options.posthogHost
        })
      };
  }
}

function collectActiveShortcuts(
  options: StartupSourceCollectShortcutOptions
): ShortcutFamily[] {
  const families: ShortcutFamily[] = [
    {
      shortcut: "github_actions",
      values: [options.githubRepo, options.githubRunId]
    },
    {
      shortcut: "vercel",
      values: [options.vercelDeployment, options.vercelTeam]
    },
    {
      shortcut: "sentry",
      values: [options.sentryOrg, options.sentryRelease, options.sentryProjectId]
    },
    {
      shortcut: "posthog",
      values: [
        options.posthogEnvironment,
        options.posthogProject,
        options.posthogInsight,
        options.posthogHost
      ]
    }
  ];

  return families.filter((family) =>
    family.values.some((value) => normalizeOptional(value) !== undefined)
  );
}

function githubActionsSourceUri(input: {
  repo: string | undefined;
  runId: string | undefined;
}): string {
  const repo = requireValue(normalizeOptional(input.repo), "--github-repo");
  const [owner, name] = parseGithubRepo(repo);
  const runId = requireValue(normalizeOptional(input.runId), "--github-run-id");

  return `https://api.github.com/repos/${pathSegment(owner)}/${pathSegment(name)}/actions/runs/${pathSegment(runId)}`;
}

function vercelSourceUri(input: {
  deployment: string | undefined;
  team: string | undefined;
}): string {
  const deployment = requireValue(
    normalizeOptional(input.deployment),
    "--vercel-deployment"
  );
  const uri = new URL(
    `https://api.vercel.com/v13/deployments/${pathSegment(deployment)}`
  );
  const team = normalizeOptional(input.team);

  if (team !== undefined) {
    uri.searchParams.set("teamId", team);
  }

  return uri.toString();
}

function sentrySourceUri(input: {
  org: string | undefined;
  release: string | undefined;
  projectId: string | undefined;
}): string {
  const org = requireValue(normalizeOptional(input.org), "--sentry-org");
  const release = requireValue(normalizeOptional(input.release), "--sentry-release");
  const uri = new URL(
    `https://sentry.io/api/0/organizations/${pathSegment(org)}/releases/${pathSegment(release)}/`
  );
  const projectId = normalizeOptional(input.projectId);

  if (projectId !== undefined) {
    uri.searchParams.set("project_id", projectId);
  }

  return uri.toString();
}

function posthogSourceUri(input: {
  environment: string | undefined;
  insight: string | undefined;
  host: string | undefined;
}): string {
  const host = normalizeHost(input.host, "https://app.posthog.com");
  const environment = requireValue(
    normalizeOptional(input.environment),
    "--posthog-environment"
  );
  const insight = requireValue(normalizeOptional(input.insight), "--posthog-insight");
  const uri = new URL(host);

  uri.pathname = `${joinUrlPath(
    uri.pathname,
    "api",
    "environments",
    environment,
    "insights",
    insight
  )}/`;

  return uri.toString();
}

function parseRequiredConnector(value: string | undefined): StartupSourceConnector {
  return parseStartupSourceConnector(
    requireValue(normalizeOptional(value), "--connector")
  );
}

function parseShortcutConnector(
  value: string | undefined,
  shortcut: StartupSourceCollectProviderShortcut
): StartupSourceConnector {
  const normalized = normalizeOptional(value);

  if (normalized === undefined) {
    return shortcut;
  }

  const connector = parseStartupSourceConnector(normalized);

  if (connector !== shortcut) {
    throw new Error(
      `--connector ${connector} cannot be combined with ${shortcut} shortcut options`
    );
  }

  return connector;
}

function parseGithubRepo(value: string): [string, string] {
  const parts = value.split("/");

  if (parts.length !== 2 || parts.some((part) => part.trim().length === 0)) {
    throw new Error("--github-repo must use owner/repo format");
  }

  return [parts[0] as string, parts[1] as string];
}

function requireValue(value: string | undefined, flag: string): string {
  if (value === undefined) {
    throw new Error(
      `${flag} is required unless --connector and --source-uri are provided`
    );
  }

  return value;
}

function normalizeOptional(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const normalized = value.trim();

  return normalized.length === 0 ? undefined : normalized;
}

function normalizeHost(value: string | undefined, fallback: string): string {
  const normalized = normalizeOptional(value) ?? fallback;

  try {
    const url = new URL(normalized);

    return `${url.origin}${trimTrailingSlash(url.pathname)}`;
  } catch {
    throw new Error("--posthog-host must be an absolute URL");
  }
}

function pathSegment(value: string): string {
  return encodeURIComponent(value);
}

function trimTrailingSlash(value: string): string {
  if (value === "/") {
    return "";
  }

  return value.replace(/\/+$/u, "");
}

function joinUrlPath(basePath: string, ...segments: string[]): string {
  return [
    trimTrailingSlash(basePath),
    ...segments.map((segment) => pathSegment(segment))
  ]
    .filter((segment) => segment.length > 0)
    .join("/")
    .replace(/^/u, "/");
}
