import { join } from "node:path";

import type { Command } from "commander";

import { collectValues } from "../cli-parsers.js";
import { registerDomainRegistryCommands } from "./domain-registry.js";

export function registerDomainCommand(program: Command): Command {
  const domain = program
    .command("domain")
    .description("Manage domain packs. Experimental.");

  domain
    .command("create")
    .description("Create a starter custom domain pack.")
    .argument("<id>", "Domain pack id")
    .option("--output <path>", "Output directory")
    .option("--name <name>", "Display name")
    .option("--description <description>", "Description")
    .option("--force", "Overwrite existing generated files")
    .action(
      async (
        id: string,
        options: {
          output?: string;
          name?: string;
          description?: string;
          force?: boolean;
        }
      ) => {
        const { createDomainPackTemplate } = await import("@runstead/domain-packs");
        const result = await createDomainPackTemplate({
          id,
          ...(options.output === undefined ? {} : { outputDir: options.output }),
          ...(options.name === undefined ? {} : { name: options.name }),
          ...(options.description === undefined
            ? {}
            : { description: options.description }),
          ...(options.force === undefined ? {} : { force: options.force })
        });

        console.log(`Created domain pack: ${result.root}`);
        for (const file of result.files) {
          console.log(`Created file: ${file}`);
        }
      }
    );

  domain
    .command("list")
    .description("List discoverable domain packs.")
    .option("--cwd <path>", "Workspace directory")
    .option("--root <path>", "Additional domain pack root", collectValues, [])
    .option("--no-built-ins", "Exclude built-in domain packs")
    .action(async (options: { cwd?: string; root: string[]; builtIns?: boolean }) => {
      const { listDomainPacks } = await import("@runstead/domain-packs");
      const roots = [...options.root];

      if (options.cwd !== undefined) {
        const { resolveRunsteadRootSync } = await import("../runstead-root.js");
        roots.push(join(resolveRunsteadRootSync(options.cwd).root, "domains"));
      }

      const result = await listDomainPacks({
        roots,
        includeBuiltIns: options.builtIns !== false
      });

      if (result.entries.length === 0) {
        console.log("No domain packs found.");
      } else {
        for (const entry of result.entries) {
          console.log(`${entry.id.padEnd(24)} ${entry.source.padEnd(9)} ${entry.root}`);
        }
      }

      for (const issue of result.issues) {
        console.error(
          `${issue.severity.toUpperCase()} ${issue.code} ${issue.root}: ${issue.message}`
        );
      }
    });

  domain
    .command("show")
    .description("Show resolved domain pack metadata.")
    .argument("<ref>", "Domain pack id or path")
    .option("--cwd <path>", "Workspace directory")
    .option("--root <path>", "Additional domain pack root", collectValues, [])
    .option("--no-built-ins", "Exclude built-in domain packs")
    .action(
      async (
        ref: string,
        options: { cwd?: string; root: string[]; builtIns?: boolean }
      ) => {
        const { formatDomainPackShowResult, showDomainPack } =
          await import("../domain-pack-command.js");
        const result = await showDomainPack(ref, {
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          roots: options.root,
          includeBuiltIns: options.builtIns !== false
        });

        console.log(formatDomainPackShowResult(result));
      }
    );

  registerDomainRegistryCommands(domain);

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

  domain
    .command("manifest")
    .description("Build a deterministic domain pack manifest.")
    .argument("<path>", "Domain pack directory")
    .option("--output <path>", "Write manifest JSON to a file")
    .action(async (path: string, options: { output?: string }) => {
      const { buildDomainPackManifest } = await import("@runstead/domain-packs");
      const manifest = await buildDomainPackManifest(path);
      const contents = `${JSON.stringify(manifest, null, 2)}\n`;

      if (options.output === undefined) {
        process.stdout.write(contents);
        return;
      }

      const { writeFile } = await import("node:fs/promises");
      await writeFile(options.output, contents, "utf8");
      console.log(`Wrote domain pack manifest: ${options.output}`);
    });

  domain
    .command("verify-manifest")
    .description("Verify a domain pack against its stored runstead-manifest.json.")
    .argument("<path>", "Domain pack directory")
    .action(async (path: string) => {
      const { formatDomainPackManifestVerificationResult, verifyDomainPackManifest } =
        await import("@runstead/domain-packs");
      const result = await verifyDomainPackManifest(path);

      console.log(formatDomainPackManifestVerificationResult(result));
      if (!result.valid) {
        process.exitCode = 1;
      }
    });

  domain
    .command("pack")
    .description("Build a deterministic domain pack bundle.")
    .argument("<path>", "Domain pack directory")
    .requiredOption("--output <path>", "Write bundle JSON to a file")
    .action(async (path: string, options: { output: string }) => {
      const { buildDomainPackBundle, serializeDomainPackBundle } =
        await import("@runstead/domain-packs");
      const { writeFile } = await import("node:fs/promises");
      const bundle = await buildDomainPackBundle(path);

      await writeFile(options.output, serializeDomainPackBundle(bundle), "utf8");
      console.log(`Wrote domain pack bundle: ${options.output}`);
      console.log(
        `Domain: ${bundle.manifest.domain.id}@${bundle.manifest.domain.version}`
      );
      console.log(`Files: ${bundle.files.length}`);
    });

  domain
    .command("unpack")
    .description("Extract a deterministic domain pack bundle.")
    .argument("<bundle>", "Domain pack bundle JSON")
    .requiredOption("--output <path>", "Destination domain pack directory")
    .option("--force", "Overwrite existing extracted files")
    .action(
      async (bundlePath: string, options: { output: string; force?: boolean }) => {
        const { extractDomainPackBundle } = await import("@runstead/domain-packs");
        const { readFile } = await import("node:fs/promises");
        const bundle = JSON.parse(await readFile(bundlePath, "utf8")) as unknown;
        const result = await extractDomainPackBundle({
          bundle,
          outputDir: options.output,
          force: options.force === true
        });

        console.log(`Extracted domain pack bundle: ${result.outputDir}`);
        console.log(`Manifest: ${result.manifestPath}`);
        console.log(`Files: ${result.files.length}`);
      }
    );

  return domain;
}
