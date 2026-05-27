import type { Command } from "commander";

export function registerDomainValidationCommands(domain: Command): void {
  domain
    .command("validate")
    .description("Validate a domain pack directory.")
    .argument("<path>", "Domain pack directory")
    .action(async (path: string) => {
      const { formatDomainPackValidationResult, validateDomainPackDir } =
        await import("@runstead/domain-packs");
      const result = await validateDomainPackDir(path);

      console.log(formatDomainPackValidationResult(result));
      if (!result.valid) {
        process.exitCode = 1;
      }
    });

  domain
    .command("maturity")
    .description(
      "Assess domain pack maturity for schema, migrations, gates, fixtures, and reports."
    )
    .argument("<path>", "Domain pack directory")
    .action(async (path: string) => {
      const { assessDomainPackMaturity, formatDomainPackMaturityResult } =
        await import("@runstead/domain-packs");
      const result = await assessDomainPackMaturity(path);

      console.log(formatDomainPackMaturityResult(result));
      if (!result.passed) {
        process.exitCode = 1;
      }
    });
}
