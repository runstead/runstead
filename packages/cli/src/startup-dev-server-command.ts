import { readFile } from "node:fs/promises";
import { join } from "node:path";

interface PackageJson {
  packageManager?: unknown;
  scripts?: unknown;
}

export async function detectStartupDevServerCommand(cwd: string): Promise<string> {
  const packageJson = await readPackageJson(cwd);
  const scripts = isRecord(packageJson.scripts) ? packageJson.scripts : {};
  const packageManager = packageManagerCommand(packageJson.packageManager);
  const scriptName = ["dev", "start", "preview"].find(
    (name) => typeof scripts[name] === "string"
  );

  if (scriptName === undefined) {
    throw new Error(
      "No dev server command found. Add a dev/start/preview script or pass --server-command."
    );
  }

  return scriptName === "start"
    ? `${packageManager} start`
    : `${packageManager} run ${scriptName}`;
}

async function readPackageJson(cwd: string): Promise<PackageJson> {
  try {
    const parsed = JSON.parse(
      await readFile(join(cwd, "package.json"), "utf8")
    ) as unknown;

    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function packageManagerCommand(value: unknown): string {
  if (typeof value !== "string") {
    return "npm";
  }

  if (value.startsWith("pnpm@")) {
    return "pnpm";
  }

  if (value.startsWith("yarn@")) {
    return "yarn";
  }

  if (value.startsWith("bun@")) {
    return "bun";
  }

  return "npm";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
