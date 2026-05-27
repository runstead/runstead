import type { Command } from "commander";

export function registerDomainBundleCommands(domain: Command): void {
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
}
