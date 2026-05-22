import { constants } from "node:fs";
import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { collectRepoInspection } from "./inspection-evidence.js";

export interface PrepareStartupRepoOnboardingOptions {
  cwd?: string;
  writeGitignore?: boolean;
  writeCi?: boolean;
  force?: boolean;
  now?: Date;
}

export interface StartupRepoOnboardingResult {
  workspace: string;
  emptyRepo: boolean;
  productFiles: string[];
  suggestedTemplate: string;
  packageManager: string;
  packageManagerSource: string;
  verifierContract: StartupVerifierCommand[];
  gitignore: {
    path: string;
    ignoredRunstead: boolean;
    changed: boolean;
  };
  ci: {
    path?: string;
    changed: boolean;
    skippedReason?: string;
  };
  stateBoundary: {
    productRoot: string;
    runsteadState: string;
    ignoredState: boolean;
  };
  firstCommitCommands: string[];
}

export interface StartupVerifierCommand {
  name: string;
  command: string;
  detected: boolean;
}

const IGNORED_PRODUCT_ENTRIES = new Set([
  ".git",
  ".runstead",
  ".gitignore",
  ".DS_Store"
]);

export async function prepareStartupRepoOnboarding(
  options: PrepareStartupRepoOnboardingOptions = {}
): Promise<StartupRepoOnboardingResult> {
  const workspace = resolve(options.cwd ?? process.cwd());
  const productFiles = await productFileEntries(workspace);
  const generatedAt = (options.now ?? new Date()).toISOString();
  const inspection = await collectRepoInspection(workspace, generatedAt);
  const packageManager = inspection.packageManager.packageManager ?? "npm";
  const verifierContract = startupVerifierContract({
    packageManager,
    commands: inspection.commands
  });
  const gitignore =
    options.writeGitignore === false
      ? await inspectGitignore(workspace)
      : await ensureRunsteadGitignore(workspace);
  const ci =
    options.writeCi === true
      ? await ensureStartupCi({
          workspace,
          verifierContract,
          force: options.force === true
        })
      : {
          changed: false,
          skippedReason: "pass --write-ci to generate GitHub Actions verifier workflow"
        };

  return {
    workspace,
    emptyRepo: productFiles.length === 0,
    productFiles,
    suggestedTemplate:
      productFiles.length === 0 ? "static-local-first-mvp" : "existing-app",
    packageManager,
    packageManagerSource: inspection.packageManager.source ?? "fallback",
    verifierContract,
    gitignore,
    ci,
    stateBoundary: {
      productRoot: workspace,
      runsteadState: join(workspace, ".runstead"),
      ignoredState: gitignore.ignoredRunstead
    },
    firstCommitCommands: [
      "git add .",
      'git commit -m "chore: onboard Runstead startup readiness"',
      "git push"
    ]
  };
}

export function formatStartupRepoOnboarding(
  result: StartupRepoOnboardingResult
): string {
  return [
    "Repo onboarding",
    `Workspace: ${result.workspace}`,
    `Empty repo: ${result.emptyRepo ? "yes" : "no"}`,
    `Suggested template: ${result.suggestedTemplate}`,
    `Package manager: ${result.packageManager} (${result.packageManagerSource})`,
    `Runstead state ignored: ${result.stateBoundary.ignoredState ? "yes" : "no"}`,
    "",
    "Verifier contract:",
    listItems(
      result.verifierContract.map(
        (item) =>
          `${item.name}: ${item.command}${item.detected ? " (detected)" : " (suggested)"}`
      )
    ),
    "",
    "CI:",
    result.ci.path === undefined
      ? `- skipped: ${result.ci.skippedReason ?? "not requested"}`
      : `- ${result.ci.changed ? "wrote" : "reused"} ${result.ci.path}`,
    "",
    "First commit commands:",
    listItems(result.firstCommitCommands)
  ].join("\n");
}

async function productFileEntries(workspace: string): Promise<string[]> {
  try {
    const entries = await readdir(workspace, { withFileTypes: true });

    return entries
      .map((entry) => entry.name)
      .filter((name) => !IGNORED_PRODUCT_ENTRIES.has(name))
      .sort((left, right) => left.localeCompare(right));
  } catch {
    return [];
  }
}

function startupVerifierContract(input: {
  packageManager: string;
  commands: Awaited<ReturnType<typeof collectRepoInspection>>["commands"];
}): StartupVerifierCommand[] {
  return [
    verifierCommand(
      "test",
      input.commands.test.command,
      `${input.packageManager} test`
    ),
    verifierCommand(
      "lint",
      input.commands.lint.command,
      `${input.packageManager} run lint`
    ),
    verifierCommand(
      "typecheck",
      input.commands.typecheck.command,
      `${input.packageManager} run typecheck`
    ),
    verifierCommand(
      "build",
      input.commands.build.command,
      `${input.packageManager} run build`
    )
  ];
}

function verifierCommand(
  name: string,
  detectedCommand: string | undefined,
  fallbackCommand: string
): StartupVerifierCommand {
  return {
    name,
    command: detectedCommand ?? fallbackCommand,
    detected: detectedCommand !== undefined
  };
}

async function inspectGitignore(
  workspace: string
): Promise<StartupRepoOnboardingResult["gitignore"]> {
  const path = join(workspace, ".gitignore");
  const contents = await readOptionalFile(path);

  return {
    path,
    ignoredRunstead: gitignoreIgnoresRunstead(contents),
    changed: false
  };
}

async function ensureRunsteadGitignore(
  workspace: string
): Promise<StartupRepoOnboardingResult["gitignore"]> {
  const path = join(workspace, ".gitignore");
  const contents = await readOptionalFile(path);

  if (gitignoreIgnoresRunstead(contents)) {
    return {
      path,
      ignoredRunstead: true,
      changed: false
    };
  }

  const next =
    contents.trimEnd().length === 0
      ? ".runstead/\n"
      : `${contents.trimEnd()}\n.runstead/\n`;

  await writeFile(path, next, "utf8");

  return {
    path,
    ignoredRunstead: true,
    changed: true
  };
}

async function ensureStartupCi(input: {
  workspace: string;
  verifierContract: StartupVerifierCommand[];
  force: boolean;
}): Promise<StartupRepoOnboardingResult["ci"]> {
  const workflowDir = join(input.workspace, ".github", "workflows");
  const path = join(workflowDir, "runstead-startup.yml");

  if (!input.force && (await exists(path))) {
    return {
      path,
      changed: false
    };
  }

  await mkdir(workflowDir, { recursive: true });
  await writeFile(path, startupCiYaml(input.verifierContract), "utf8");

  return {
    path,
    changed: true
  };
}

function startupCiYaml(verifierContract: StartupVerifierCommand[]): string {
  return [
    "name: Runstead Startup Verifiers",
    "",
    "on:",
    "  push:",
    "  pull_request:",
    "",
    "jobs:",
    "  verify:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@v4",
    ...verifierContract.map((item) => `      - run: ${item.command}`),
    ""
  ].join("\n");
}

function gitignoreIgnoresRunstead(contents: string): boolean {
  return contents
    .split("\n")
    .map((line) => line.trim())
    .some((line) => line === ".runstead/" || line === ".runstead");
}

async function readOptionalFile(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function listItems(items: string[]): string {
  return items.map((item) => `- ${item}`).join("\n");
}
