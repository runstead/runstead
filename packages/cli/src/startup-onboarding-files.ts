import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { listItems } from "./startup-founder-format.js";
import type { StartupRepoOnboardingResult } from "./startup-repo-onboarding.js";

export async function writeStartupOnboardingFiles(input: {
  root: string;
  repo: StartupRepoOnboardingResult;
  nextCommands: string[];
  generatedAt: string;
}): Promise<string[]> {
  const startupDir = join(input.root, "startup");
  const quickstartPath = join(startupDir, "quickstart.md");
  const upgradePath = join(startupDir, "upgrade-guide.md");

  await mkdir(startupDir, { recursive: true });
  await Promise.all([
    writeFile(quickstartPath, formatStartupQuickstart(input), "utf8"),
    writeFile(upgradePath, formatStartupUpgradeGuide(input), "utf8")
  ]);

  return [quickstartPath, upgradePath];
}

function formatStartupQuickstart(input: {
  repo: StartupRepoOnboardingResult;
  nextCommands: string[];
  generatedAt: string;
}): string {
  return [
    "# Runstead Startup Quickstart",
    "",
    `Generated: ${input.generatedAt}`,
    `Workspace: ${input.repo.workspace}`,
    `Suggested template: ${input.repo.suggestedTemplate}`,
    `Package manager: ${input.repo.packageManager} (${input.repo.packageManagerSource})`,
    "",
    "## Verifier Contract",
    "",
    listItems(
      input.repo.verifierContract.map(
        (verifier) =>
          `${verifier.name}: ${verifier.command}${verifier.detected ? " (detected)" : " (suggested)"}`
      )
    ),
    "",
    "## First Run",
    "",
    listItems(input.nextCommands),
    "",
    "## Review Surfaces",
    "",
    listItems([
      "Markdown reports live in .runstead/reports/.",
      "Startup artifacts live in .runstead/startup/.",
      "Run runstead startup status after each build or launch check."
    ]),
    ""
  ].join("\n");
}

function formatStartupUpgradeGuide(input: {
  repo: StartupRepoOnboardingResult;
  generatedAt: string;
}): string {
  return [
    "# Runstead Startup Upgrade Guide",
    "",
    `Generated: ${input.generatedAt}`,
    "",
    "## Before Upgrade",
    "",
    listItems([
      "Commit or stash product changes before upgrading Runstead state.",
      "Run runstead doctor --cwd . and resolve failed checks.",
      "Keep .runstead/ ignored unless the team intentionally tracks generated state."
    ]),
    "",
    "## Upgrade Commands",
    "",
    listItems([
      "runstead upgrade --cwd .",
      "runstead domain upgrade ai-native-startup --cwd . --force",
      "runstead startup launch-check --cwd ."
    ]),
    "",
    "## Compatibility Notes",
    "",
    listItems([
      `Detected package manager: ${input.repo.packageManager} (${input.repo.packageManagerSource}).`,
      "Runstead CLI expects Node >=24.15 <27.",
      "Domain pack upgrades record migration steps in the audit log."
    ]),
    ""
  ].join("\n");
}
