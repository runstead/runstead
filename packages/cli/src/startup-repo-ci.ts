import { constants } from "node:fs";
import { access, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type {
  StartupRepoOnboardingResult,
  StartupVerifierCommand
} from "./startup-repo-onboarding.js";

export async function ensureStartupCi(input: {
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
  const verifierCommands = verifierContract.map(
    (item) => `# detected ${item.name}: ${item.command}`
  );

  return [
    "name: Runstead Startup Readiness",
    "",
    "on:",
    "  push:",
    "  pull_request:",
    "",
    "permissions:",
    "  contents: read",
    "  pull-requests: write",
    "",
    "jobs:",
    "  readiness:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@v4",
    "      - name: Run startup readiness",
    "        run: runstead startup ready --stage launch --target local --ci",
    "      - name: Upload Runstead readiness artifacts",
    "        uses: actions/upload-artifact@v4",
    "        if: always()",
    "        with:",
    "          name: runstead-startup-readiness",
    "          path: |",
    "            .runstead/reports/startup-readiness-run-*",
    "            .runstead/reports/runstead-startup-ci-summary.*",
    ...verifierCommands.map((command) => `    ${command}`),
    ""
  ].join("\n");
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}
