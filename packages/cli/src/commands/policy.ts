import type { Command } from "commander";

export function registerPolicyCommand(program: Command): Command {
  const policy = program.command("policy").description("Evaluate policies.");

  policy
    .command("test")
    .description("Evaluate a policy YAML file against an action YAML file.")
    .argument("<policy>", "Policy YAML path")
    .requiredOption("--action <path>", "Action envelope YAML path")
    .action(async (policyPath: string, options: { action: string }) => {
      const { formatPolicyTestReport, testPolicyAction } =
        await import("../policy-command.js");
      const result = await testPolicyAction({
        policyPath,
        actionPath: options.action
      });

      console.log(formatPolicyTestReport(result));
    });

  return policy;
}
