import type { Command } from "commander";

import { registerAgentFixCommands } from "./agent-fix.js";
import { registerAgentInspectCommand } from "./agent-inspect.js";
import { registerAgentLifecycleCommands } from "./agent-lifecycle.js";
import { registerAgentProvidersCommand } from "./agent-providers.js";
import { registerAgentReviewCommand } from "./agent-review.js";
import { registerAgentRunCommand } from "./agent-run.js";
import { registerAgentTestCommand } from "./agent-test.js";

export function registerAgentCommand(program: Command): Command {
  const command = program.command("agent").description("Run local repo agent tasks.");

  addAgentCommand(command);

  return command;
}

function addAgentCommand(command: Command): void {
  registerAgentProvidersCommand(command);
  registerAgentRunCommand(command);

  registerAgentInspectCommand(command);
  registerAgentReviewCommand(command);

  registerAgentTestCommand(command);
  registerAgentFixCommands(command);
  registerAgentLifecycleCommands(command);
}
