import type { Command } from "commander";

import { registerMemoryFactCommands } from "./memory-fact.js";
import { registerMemoryQuarantineCommand } from "./memory-quarantine.js";

export function registerMemoryCommand(program: Command): Command {
  const memory = program
    .command("memory")
    .description("Manage governed memory. Experimental.");

  registerMemoryQuarantineCommand(memory);
  registerMemoryFactCommands(memory);

  return memory;
}
