import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { resolveRunsteadRoot } from "./runstead-root.js";
import {
  genericTodoUiSmokeFlowActions,
  staticTodoUiSmokeFlowActions
} from "./startup-ready-ui-smoke-todo-flows.js";
import type { StartupUiFlowAction } from "./startup-ui-validation-types.js";

export { startupReadyMobileNoOverlapActions } from "./startup-ready-ui-smoke-todo-flows.js";

export async function inferStartupReadyUiSmokeFlowActions(
  cwd: string
): Promise<StartupUiFlowAction[]> {
  const signals = (
    await Promise.all([
      readOptionalTextFile(join(cwd, "package.json")),
      readOptionalTextFile(join(cwd, "README.md")),
      readOptionalTextFile(join(cwd, "index.html")),
      readOptionalTextFile(join(cwd, "src", "App.tsx")),
      readOptionalTextFile(join(cwd, "src", "App.jsx")),
      readOptionalTextFile(join(cwd, ".runstead", "startup", "scaffold-profile.json"))
    ])
  ).join("\n");

  if (!/\btodo\b|\btodos\b|\btask\b|\btasks\b/i.test(signals)) {
    return [];
  }

  if (await hasStartupReadyStaticTodoScaffold(cwd)) {
    return staticTodoUiSmokeFlowActions();
  }

  return genericTodoUiSmokeFlowActions();
}

export async function hasStartupReadyStaticTodoScaffold(cwd: string): Promise<boolean> {
  const direct = await startupReadyScaffoldProfileText(
    join(cwd, ".runstead", "startup", "scaffold-profile.json")
  );

  if (direct !== undefined) {
    return direct;
  }

  try {
    const root = await resolveRunsteadRoot(cwd);

    return (
      (await startupReadyScaffoldProfileText(
        join(root.root, "startup", "scaffold-profile.json")
      )) ?? false
    );
  } catch {
    return false;
  }
}

async function startupReadyScaffoldProfileText(
  path: string
): Promise<boolean | undefined> {
  const contents = await readOptionalTextFile(path);

  if (contents.trim().length === 0) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(contents) as unknown;
    const profile = isRecord(parsed) ? parsed.profile : undefined;

    return (
      (isRecord(profile) &&
        (profile.id === "static-todo" || profile.template === "static-todo")) ||
      (isRecord(parsed) &&
        (parsed.id === "static-todo" || parsed.template === "static-todo"))
    );
  } catch {
    return false;
  }
}

async function readOptionalTextFile(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
