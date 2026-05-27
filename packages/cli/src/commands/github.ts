import type { Command } from "commander";

import { addGitHubAppCommands } from "./github-app.js";
import { registerGitHubPrCommand } from "./github-pr.js";
import { registerGitHubRunCommand } from "./github-run.js";

export function registerGitHubCommand(program: Command): Command {
  const github = program.command("github").description("GitHub integration.");
  addGitHubAppCommands(github);
  registerGitHubRunCommand(github);
  registerGitHubPrCommand(github);

  return github;
}
