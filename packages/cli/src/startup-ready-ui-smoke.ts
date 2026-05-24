import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { resolveRunsteadRoot } from "./runstead-root.js";
import { detectStartupDevServerCommand } from "./startup-dev-server.js";
import {
  classifyStartupUiValidationFailure,
  executeStartupUiValidation,
  summarizeStartupUiValidationFailure,
  startupUiValidationRepairHint,
  type StartupUiFlowAction,
  type StartupUiValidationExecutionEvidence
} from "./startup-ui-validation.js";

const DEFAULT_UI_SMOKE_TIMEOUT_MS = 20_000;

export interface StartupReadyUiSmokeConfig {
  schemaVersion: 1;
  server: StartupReadyUiSmokeServerConfig;
  checks: StartupReadyUiSmokeCheckConfig[];
}

export interface StartupReadyUiSmokeServerConfig {
  command: string;
  port: number;
  url?: string;
  timeoutMs?: number;
}

export interface StartupReadyUiSmokeCheckConfig {
  name: string;
  url?: string;
  viewport?: string;
  expectText: string[];
  flow?: string;
  steps?: StartupUiFlowAction[];
  timeoutMs?: number;
}

export interface StartupReadyUiSmokeRunResult {
  status: "passed" | "blocked";
  configPath: string;
  configStatus: "generated" | "loaded" | "blocked";
  configWarnings: string[];
  configRepairHints: string[];
  checks: StartupReadyUiSmokeCheckResult[];
  evidenceIds: string[];
  artifacts: string[];
  blockers: string[];
}

export interface StartupReadyUiSmokeCheckResult {
  name: string;
  status: "passed" | "failed";
  evidenceId?: string;
  artifact?: string;
  failureCategory?: string;
  failureSummary?: string;
  repairHint?: string;
  failedAction?: NonNullable<StartupUiValidationExecutionEvidence["flowActions"]>[number];
  blockers: string[];
}

export async function executeStartupReadyUiSmoke(input: {
  cwd?: string;
  now?: Date;
}): Promise<StartupReadyUiSmokeRunResult> {
  const cwd = resolve(input.cwd ?? process.cwd());
  const loaded = await loadOrCreateStartupReadyUiSmokeConfig(cwd);

  if (loaded.config === undefined) {
    return {
      status: "blocked",
      configPath: loaded.path,
      configStatus: "blocked",
      configWarnings: [],
      configRepairHints: [],
      checks: [],
      evidenceIds: [],
      artifacts: [],
      blockers: [loaded.blocker ?? "UI smoke config is missing"]
    };
  }

  const checks: StartupReadyUiSmokeCheckResult[] = [];

  for (const check of loaded.config.checks) {
    try {
      const url = check.url ?? loaded.config.server.url;
      const result = await executeStartupUiValidation({
        cwd,
        viewport: check.viewport ?? "desktop",
        serverCommand: loaded.config.server.command,
        serverPort: loaded.config.server.port,
        timeoutMs:
          check.timeoutMs ??
          loaded.config.server.timeoutMs ??
          DEFAULT_UI_SMOKE_TIMEOUT_MS,
        expectText: check.expectText,
        ...(check.steps === undefined ? {} : { flowActions: check.steps }),
        ...(url === undefined ? {} : { url }),
        ...(check.flow === undefined ? {} : { criticalFlow: check.flow }),
        ...(input.now === undefined ? {} : { now: input.now })
      });
      const failureSummary = result.failed
        ? summarizeStartupUiValidationFailure(result.execution)
        : undefined;
      const failureCategory = result.failed
        ? classifyStartupUiValidationFailure(result.execution)
        : undefined;
      const repairHint = result.failed
        ? startupUiValidationRepairHint(result.execution)
        : undefined;
      const failedAction = result.failed
        ? result.execution.flowActions?.find((action) => action.status === "fail")
        : undefined;

      checks.push({
        name: check.name,
        status: result.failed ? "failed" : "passed",
        evidenceId: result.evidence.evidence.id,
        artifact: result.domArtifact,
        ...(failureCategory === undefined ? {} : { failureCategory }),
        ...(failureSummary === undefined ? {} : { failureSummary }),
        ...(repairHint === undefined ? {} : { repairHint }),
        ...(failedAction === undefined ? {} : { failedAction }),
        blockers: result.failed
          ? [
              `UI smoke check failed: ${check.name}: ${failureCategory ?? "unknown"}: ${failureSummary}; suggested patch: ${repairHint}`
            ]
          : []
      });
    } catch (error) {
      checks.push({
        name: check.name,
        status: "failed",
        blockers: [`UI smoke check failed: ${check.name}: ${errorMessage(error)}`]
      });
    }
  }

  const blockers = checks.flatMap((check) => check.blockers);
  const evidenceIds = checks
    .map((check) => check.evidenceId)
    .filter((id): id is string => id !== undefined);
  const artifacts = [
    loaded.path,
    ...checks
      .map((check) => check.artifact)
      .filter((artifact): artifact is string => artifact !== undefined)
  ];

  return {
    status: blockers.length === 0 ? "passed" : "blocked",
    configPath: loaded.path,
    configStatus: loaded.status,
    configWarnings: loaded.warnings,
    configRepairHints: loaded.repairHints,
    checks,
    evidenceIds,
    artifacts,
    blockers
  };
}

async function loadOrCreateStartupReadyUiSmokeConfig(cwd: string): Promise<
  | {
      path: string;
      status: "loaded" | "generated";
      config: StartupReadyUiSmokeConfig;
      warnings: string[];
      repairHints: string[];
    }
  | {
      path: string;
      status: "blocked";
      blocker: string;
      config?: undefined;
    }
> {
  const root = await resolveRunsteadRoot(cwd);
  const path = startupReadyUiSmokePath(root.root);
  const existing = await readOptionalTextFile(path);

  if (existing.trim().length > 0) {
    const loaded = parseStartupReadyUiSmokeConfig(existing, path);

    return {
      path,
      status: "loaded",
      config: loaded.config,
      warnings: loaded.warnings,
      repairHints: loaded.repairHints
    };
  }

  try {
    const command = await detectStartupDevServerCommand(cwd);
    const config = await defaultStartupReadyUiSmokeConfig(cwd, command);

    await mkdir(join(root.root, "startup"), { recursive: true });
    await writeFile(path, stringifyStartupReadyUiSmokeConfig(config), "utf8");

    return {
      path,
      status: "generated",
      config,
      warnings: [],
      repairHints: []
    };
  } catch (error) {
    return {
      path,
      status: "blocked",
      blocker: errorMessage(error)
    };
  }
}

export async function defaultStartupReadyUiSmokeConfig(
  cwd: string,
  command: string
): Promise<StartupReadyUiSmokeConfig> {
  const expectText = await inferStartupReadyUiSmokeExpectText(cwd);
  const steps = await inferStartupReadyUiSmokeFlowActions(cwd);
  const staticTodo = await hasStartupReadyStaticTodoScaffold(cwd);
  const mobileSteps = staticTodo
    ? startupReadyMobileNoOverlapActions()
    : [];

  return {
    schemaVersion: 1,
    server: {
      command,
      port: 3000,
      url: "http://127.0.0.1:3000",
      timeoutMs: DEFAULT_UI_SMOKE_TIMEOUT_MS
    },
    checks: [
      {
        name: steps.length === 0 ? "home-desktop" : "home-desktop-product-flow",
        url: "http://127.0.0.1:3000",
        viewport: "desktop",
        expectText,
        flow:
          steps.length === 0
            ? "load the primary product route"
            : staticTodo
              ? "todo workflow: add, edit, complete, search/filter, delete, clear completed, reload persistence"
              : "todo golden path: add, toggle, search/filter, reload persistence",
        ...(steps.length === 0 ? {} : { steps })
      },
      {
        name:
          mobileSteps.length === 0 ? "home-mobile" : "home-mobile-product-layout",
        url: "http://127.0.0.1:3000",
        viewport: "mobile",
        expectText,
        flow:
          mobileSteps.length === 0
            ? "load the primary product route on mobile viewport"
            : "mobile layout: no overlapping todo controls",
        ...(mobileSteps.length === 0 ? {} : { steps: mobileSteps })
      }
    ]
  };
}

export async function inferStartupReadyUiSmokeExpectText(
  cwd: string
): Promise<string[]> {
  const [packageText, htmlTexts, readmeTexts] = await Promise.all([
    inferExpectTextFromPackageJson(cwd),
    inferExpectTextFromHtmlFiles(cwd),
    inferExpectTextFromReadme(cwd)
  ]);

  const inferred = unique([...htmlTexts, ...readmeTexts, ...packageText]).slice(0, 6);

  return inferred.length === 0 ? ["html"] : inferred;
}

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

function genericTodoUiSmokeFlowActions(): StartupUiFlowAction[] {
  const smokeTodo = "Runstead smoke todo";

  return [
    {
      type: "fill",
      selectors: [
        "[data-testid='new-todo-input']",
        "[data-testid='todo-input']",
        "[data-testid='new-task-input']",
        "[data-testid='task-input']",
        "form:has(button[type='submit']) input:not([type='search']):not([aria-label*='search' i]):not([placeholder*='search' i])",
        "form:has(button[type='submit']) textarea:not([aria-label*='search' i]):not([placeholder*='search' i])",
        "#todo-input",
        "#task-input",
        "input[name='todo']",
        "input[name='task']",
        "input[aria-label*='new' i][aria-label*='todo' i]",
        "input[aria-label*='new' i][aria-label*='task' i]",
        "input[aria-label*='add' i][aria-label*='todo' i]",
        "input[aria-label*='add' i][aria-label*='task' i]",
        "input[placeholder*='new' i][placeholder*='todo' i]",
        "input[placeholder*='new' i][placeholder*='task' i]",
        "input[placeholder*='add' i][placeholder*='todo' i]",
        "input[placeholder*='add' i][placeholder*='task' i]",
        "form input[type='text']:not([aria-label*='search' i]):not([placeholder*='search' i])",
        "input[type='text']:not([aria-label*='search' i]):not([placeholder*='search' i])",
        "input:not([type]):not([aria-label*='search' i]):not([placeholder*='search' i])",
        "textarea:not([aria-label*='search' i]):not([placeholder*='search' i])"
      ],
      value: smokeTodo
    },
    {
      type: "click",
      selectors: [
        "[data-testid='add-todo']",
        "[data-testid='add-task']",
        "button[type='submit']",
        "button:has-text('Add')",
        "text=Add"
      ]
    },
    {
      type: "expectText",
      text: smokeTodo
    },
    {
      type: "click",
      selectors: [
        "[data-testid='todo-item'] input[type='checkbox']",
        "[data-testid='task-item'] input[type='checkbox']",
        "input[type='checkbox']",
        `text=${smokeTodo}`
      ]
    },
    {
      type: "fill",
      selectors: [
        "[data-testid='todo-search']",
        "[data-testid='task-search']",
        "#todo-search",
        "#task-search",
        "input[name='todo-search']",
        "input[name='task-search']",
        "input[name='search']",
        "input[aria-label*='search' i]",
        "input[placeholder*='search' i]",
        "input[type='search']"
      ],
      value: "Runstead"
    },
    {
      type: "expectText",
      text: smokeTodo
    },
    {
      type: "click",
      selectors: [
        "[data-testid='filter-active']",
        "[aria-label*='active' i]",
        "button:has-text('Active')",
        "text=Active"
      ]
    },
    {
      type: "click",
      selectors: [
        "[data-testid='filter-all']",
        "[aria-label*='all' i]",
        "button:has-text('All')",
        "text=All"
      ]
    },
    {
      type: "expectPersisted",
      text: smokeTodo
    }
  ];
}

function staticTodoUiSmokeFlowActions(): StartupUiFlowAction[] {
  const smokeTodo = "Runstead smoke todo";
  const editedTodo = "Runstead edited todo";

  return [
    {
      type: "fill",
      selectors: todoInputSelectors(),
      value: smokeTodo
    },
    {
      type: "click",
      selectors: addTodoSelectors()
    },
    {
      type: "expectText",
      text: smokeTodo
    },
    {
      type: "click",
      selectors: [
        "[data-testid='edit-todo']",
        "[data-testid='todo-edit']",
        "[aria-label*='edit' i]",
        "button:has-text('Edit')",
        "text=Edit"
      ]
    },
    {
      type: "fill",
      selectors: [
        "[data-testid='todo-edit-input']",
        "[data-testid='edit-todo-input']",
        "input[name='todo-edit']",
        "input[name='edit-todo']",
        "input[aria-label*='edit' i]",
        "[data-testid='todo-item'] input[type='text']"
      ],
      value: editedTodo
    },
    {
      type: "click",
      selectors: [
        "[data-testid='save-todo']",
        "[data-testid='todo-save']",
        "[aria-label*='save' i]",
        "button:has-text('Save')",
        "text=Save"
      ]
    },
    {
      type: "expectText",
      text: editedTodo
    },
    {
      type: "click",
      selectors: [
        "[data-testid='todo-toggle']",
        "[data-testid='todo-item'] input[type='checkbox']",
        "[aria-label*='complete' i]",
        "input[type='checkbox']",
        `text=${editedTodo}`
      ]
    },
    {
      type: "fill",
      selectors: todoSearchSelectors(),
      value: "edited"
    },
    {
      type: "expectText",
      text: editedTodo
    },
    {
      type: "click",
      selectors: [
        "[data-testid='filter-completed']",
        "[aria-label*='completed' i]",
        "button:has-text('Completed')",
        "text=Completed"
      ]
    },
    {
      type: "expectText",
      text: editedTodo
    },
    {
      type: "click",
      selectors: [
        "[data-testid='filter-active']",
        "[aria-label*='active' i]",
        "button:has-text('Active')",
        "text=Active"
      ]
    },
    {
      type: "click",
      selectors: [
        "[data-testid='filter-all']",
        "[aria-label*='all' i]",
        "button:has-text('All')",
        "text=All"
      ]
    },
    {
      type: "expectPersisted",
      text: editedTodo
    },
    {
      type: "click",
      selectors: [
        "[data-testid='delete-todo']",
        "[data-testid='remove-todo']",
        "[aria-label*='delete' i]",
        "[aria-label*='remove' i]",
        "button:has-text('Delete')",
        "button:has-text('Remove')",
        "text=Delete",
        "text=Remove"
      ]
    },
    {
      type: "expectCount",
      selector: "[data-testid='todo-item']",
      count: 0
    },
    {
      type: "fill",
      selectors: todoInputSelectors(),
      value: smokeTodo
    },
    {
      type: "click",
      selectors: addTodoSelectors()
    },
    {
      type: "click",
      selectors: [
        "[data-testid='todo-toggle']",
        "[data-testid='todo-item'] input[type='checkbox']",
        "[aria-label*='complete' i]",
        "input[type='checkbox']",
        `text=${smokeTodo}`
      ]
    },
    {
      type: "click",
      selectors: [
        "[data-testid='clear-completed']",
        "[data-testid='clear-completed-todos']",
        "[aria-label*='clear' i][aria-label*='completed' i]",
        "button:has-text('Clear completed')",
        "text=Clear completed"
      ]
    },
    {
      type: "expectCount",
      selector: "[data-testid='todo-item']",
      count: 0
    }
  ];
}

function todoInputSelectors(): string[] {
  return [
    "[data-testid='new-todo-input']",
    "[data-testid='todo-input']",
    "[data-testid='new-task-input']",
    "[data-testid='task-input']",
    "form:has(button[type='submit']) input:not([type='search']):not([aria-label*='search' i]):not([placeholder*='search' i])",
    "form:has(button[type='submit']) textarea:not([aria-label*='search' i]):not([placeholder*='search' i])",
    "#todo-input",
    "#task-input",
    "input[name='todo']",
    "input[name='task']",
    "input[aria-label*='new' i][aria-label*='todo' i]",
    "input[aria-label*='new' i][aria-label*='task' i]",
    "input[aria-label*='add' i][aria-label*='todo' i]",
    "input[aria-label*='add' i][aria-label*='task' i]",
    "input[placeholder*='new' i][placeholder*='todo' i]",
    "input[placeholder*='new' i][placeholder*='task' i]",
    "input[placeholder*='add' i][placeholder*='todo' i]",
    "input[placeholder*='add' i][placeholder*='task' i]",
    "form input[type='text']:not([aria-label*='search' i]):not([placeholder*='search' i])",
    "input[type='text']:not([aria-label*='search' i]):not([placeholder*='search' i])",
    "input:not([type]):not([aria-label*='search' i]):not([placeholder*='search' i])",
    "textarea:not([aria-label*='search' i]):not([placeholder*='search' i])"
  ];
}

function addTodoSelectors(): string[] {
  return [
    "[data-testid='add-todo']",
    "[data-testid='add-task']",
    "button[type='submit']",
    "button:has-text('Add')",
    "text=Add"
  ];
}

function todoSearchSelectors(): string[] {
  return [
    "[data-testid='todo-search']",
    "[data-testid='task-search']",
    "#todo-search",
    "#task-search",
    "input[name='todo-search']",
    "input[name='task-search']",
    "input[name='search']",
    "input[aria-label*='search' i]",
    "input[placeholder*='search' i]",
    "input[type='search']"
  ];
}

function startupReadyMobileNoOverlapActions(): StartupUiFlowAction[] {
  return [
    {
      type: "expectNoOverlap",
      selectors: [
        "[data-testid='new-todo-input']",
        "[data-testid='todo-input']",
        "[data-testid='add-todo']",
        "[data-testid='todo-search']",
        "[data-testid='filter-active']",
        "[data-testid='filter-completed']",
        "[data-testid='filter-all']",
        "[data-testid='clear-completed']"
      ]
    }
  ];
}

async function hasStartupReadyStaticTodoScaffold(cwd: string): Promise<boolean> {
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

async function inferExpectTextFromPackageJson(cwd: string): Promise<string[]> {
  try {
    const parsed = JSON.parse(
      await readFile(join(cwd, "package.json"), "utf8")
    ) as unknown;

    if (!isRecord(parsed) || typeof parsed.name !== "string") {
      return [];
    }

    const displayName = packageNameToDisplayText(parsed.name);

    return displayName.length === 0 ? [] : [displayName];
  } catch {
    return [];
  }
}

async function inferExpectTextFromHtmlFiles(cwd: string): Promise<string[]> {
  const paths = [
    join(cwd, "index.html"),
    join(cwd, "public", "index.html"),
    join(cwd, "src", "index.html")
  ];
  const texts: string[] = [];

  for (const path of paths) {
    const contents = await readOptionalTextFile(path);

    if (contents.length === 0) {
      continue;
    }

    texts.push(...extractHtmlSignalText(contents));
  }

  return texts;
}

async function inferExpectTextFromReadme(cwd: string): Promise<string[]> {
  for (const name of ["README.md", "readme.md"]) {
    const contents = await readOptionalTextFile(join(cwd, name));
    const match = /^#\s+(.+)$/m.exec(contents);
    const heading = match?.[1]?.trim();

    if (heading !== undefined && heading.length > 0) {
      return [heading];
    }
  }

  return [];
}

function extractHtmlSignalText(contents: string): string[] {
  const texts: string[] = [];
  const patterns = [
    /<title[^>]*>([^<]+)<\/title>/gi,
    /<h1[^>]*>([^<]+)<\/h1>/gi,
    /<button[^>]*>([^<]+)<\/button>/gi,
    /aria-label=["']([^"']+)["']/gi,
    /placeholder=["']([^"']+)["']/gi
  ];

  for (const pattern of patterns) {
    for (const match of contents.matchAll(pattern)) {
      const text = normalizeUiText(match[1]);

      if (text !== undefined) {
        texts.push(text);
      }
    }
  }

  return texts;
}

function packageNameToDisplayText(name: string): string {
  const unscoped = name.includes("/") ? (name.split("/").pop() ?? name) : name;

  return unscoped
    .split(/[-_\s]+/u)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function normalizeUiText(value: string | undefined): string | undefined {
  const text = value?.replace(/\s+/gu, " ").trim();

  return text === undefined || text.length === 0 ? undefined : text;
}

function stringifyStartupReadyUiSmokeConfig(config: StartupReadyUiSmokeConfig): string {
  return stringifyYaml(config, { lineWidth: 0 });
}

function parseStartupReadyUiSmokeConfig(
  contents: string,
  path: string
): {
  config: StartupReadyUiSmokeConfig;
  warnings: string[];
  repairHints: string[];
} {
  const parsed = parseYaml(contents) as unknown;

  if (!isRecord(parsed)) {
    throw new Error(`UI smoke config must be a YAML object: ${path}`);
  }

  const warnings: string[] = [];
  const repairHints: string[] = [];
  const server = startupReadyUiSmokeServerObject(parsed);
  const checks = Array.isArray(parsed.checks) ? parsed.checks : [];
  const usesLegacyStartupShape = isRecord(parsed.startup);
  const usesLegacyCheckShape = checks.some(
    (check) => isRecord(check) && (isRecord(check.request) || isRecord(check.expect))
  );

  if (usesLegacyStartupShape || usesLegacyCheckShape) {
    warnings.push("legacy UI smoke config shape was auto-normalized");
    repairHints.push(
      "Prefer schemaVersion/server.command/server.port/checks[].expectText for durable UI smoke configs."
    );
  }

  if (server === undefined) {
    throw new Error(`UI smoke config is missing server settings: ${path}`);
  }

  const command = stringValue(server.command);
  const url = stringValue(server.url);
  const port = numberValue(server.port) ?? portFromUrl(url);
  const timeoutMs = numberValue(server.timeoutMs);

  if (command === undefined || port === undefined) {
    throw new Error(
      `UI smoke config server.command and server.port are required: ${path}`
    );
  }

  if (checks.length === 0) {
    throw new Error(`UI smoke config requires at least one check: ${path}`);
  }

  return {
    config: {
      schemaVersion: 1,
      server: {
        command,
        port,
        ...(url === undefined ? {} : { url }),
        ...(timeoutMs === undefined ? {} : { timeoutMs })
      },
      checks: checks.flatMap((check, index) =>
        parseStartupReadyUiSmokeCheck(check, index, path)
      )
    },
    warnings,
    repairHints
  };
}

function startupReadyUiSmokeServerObject(
  parsed: Record<string, unknown>
): Record<string, unknown> | undefined {
  if (isRecord(parsed.server)) {
    return parsed.server;
  }

  const startup = isRecord(parsed.startup) ? parsed.startup : undefined;

  if (startup === undefined) {
    return undefined;
  }

  const readyWhen = isRecord(startup.readyWhen) ? startup.readyWhen : undefined;

  return {
    command: startup.run,
    url: readyWhen?.url,
    port: readyWhen?.port,
    timeoutMs: startup.timeoutMs ?? readyWhen?.timeoutMs
  };
}

function parseStartupReadyUiSmokeCheck(
  input: unknown,
  index: number,
  path: string
): StartupReadyUiSmokeCheckConfig[] {
  if (!isRecord(input)) {
    throw new Error(`UI smoke check ${index + 1} must be an object: ${path}`);
  }

  const name = stringValue(input.name) ?? `check-${index + 1}`;
  const legacyRequest = isRecord(input.request) ? input.request : undefined;
  const legacyExpect = isRecord(input.expect) ? input.expect : undefined;
  const expectText = [
    ...arrayOfStrings(input.expectText),
    ...arrayOfStrings(input.expect),
    ...arrayOfStrings(legacyExpect?.bodyContains),
    ...arrayOfStrings(legacyExpect?.expectText),
    ...arrayOfStrings(legacyExpect?.text)
  ];
  const url = stringValue(input.url) ?? stringValue(legacyRequest?.url);
  const viewport = stringValue(input.viewport);
  const viewports = unique([
    ...(viewport === undefined ? [] : [viewport]),
    ...arrayOfStrings(input.viewports)
  ]);
  const parsedFlowSteps = parseStartupReadyUiSmokeSteps(input.steps ?? input.flow);
  const flow =
    typeof input.flow === "string"
      ? input.flow
      : (stringValue(input.description) ??
        (parsedFlowSteps.length === 0
          ? undefined
          : "configured UI smoke interaction flow"));
  const timeoutMs = numberValue(input.timeoutMs);

  const base = {
    name,
    ...(url === undefined ? {} : { url }),
    expectText,
    ...(flow === undefined ? {} : { flow }),
    ...(parsedFlowSteps.length === 0 ? {} : { steps: parsedFlowSteps }),
    ...(timeoutMs === undefined ? {} : { timeoutMs })
  };

  if (viewports.length === 0) {
    return [base];
  }

  return viewports.map((item) => ({
    ...base,
    name: viewports.length === 1 ? name : `${name}-${uiSmokeViewportSlug(item)}`,
    viewport: item
  }));
}

function uiSmokeViewportSlug(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "");

  return slug.length === 0 ? "viewport" : slug;
}

function parseStartupReadyUiSmokeSteps(value: unknown): StartupUiFlowAction[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item, index) => parseStartupReadyUiSmokeStep(item, index));
}

function parseStartupReadyUiSmokeStep(
  value: unknown,
  index: number
): StartupUiFlowAction {
  if (!isRecord(value)) {
    throw new Error(`UI smoke flow step ${index + 1} must be an object`);
  }

  const type = stringValue(value.type);
  const normalized =
    type === undefined && Object.keys(value).length === 1
      ? keyedFlowAction(value)
      : value;
  const normalizedType = stringValue(normalized.type);

  switch (normalizedType) {
    case "fill":
      return {
        type: "fill",
        ...flowSelectors(normalized),
        value: requiredStringValue(normalized.value, `UI smoke fill ${index + 1}`)
      };
    case "select":
      return {
        type: "select",
        ...flowSelectors(normalized),
        value: requiredStringValue(normalized.value, `UI smoke select ${index + 1}`)
      };
    case "click":
      return {
        type: "click",
        ...flowSelectors(normalized)
      };
    case "expectText":
      return {
        type: "expectText",
        text: requiredStringValue(
          normalized.text ?? normalized.value,
          `UI smoke expectText ${index + 1}`
        )
      };
    case "expectCount":
      return {
        type: "expectCount",
        selector: requiredStringValue(
          normalized.selector,
          `UI smoke expectCount selector ${index + 1}`
        ),
        count: requiredNumberValue(
          normalized.count,
          `UI smoke expectCount count ${index + 1}`
        )
      };
    case "reload":
      return {
        type: "reload"
      };
    case "expectPersisted":
      return {
        type: "expectPersisted",
        text: requiredStringValue(
          normalized.text ?? normalized.value,
          `UI smoke expectPersisted ${index + 1}`
        ),
        ...flowSelectors(normalized)
      };
    case "expectNoOverlap":
      return {
        type: "expectNoOverlap",
        selectors: requiredSelectorList(
          normalized,
          `UI smoke expectNoOverlap selectors ${index + 1}`
        )
      };
    default:
      throw new Error(
        `Unsupported UI smoke flow step ${index + 1}: ${String(normalizedType)}`
      );
  }
}

function keyedFlowAction(value: Record<string, unknown>): Record<string, unknown> {
  const [type, payload] = Object.entries(value)[0] ?? [];

  return isRecord(payload) ? { type, ...payload } : { type, value: payload };
}

function flowSelectors(value: Record<string, unknown>): {
  selector?: string;
  selectors?: string[];
} {
  return {
    ...(typeof value.selector === "string" ? { selector: value.selector } : {}),
    ...(!Array.isArray(value.selectors)
      ? {}
      : { selectors: arrayOfStrings(value.selectors) })
  };
}

function requiredSelectorList(
  value: Record<string, unknown>,
  label: string
): string[] {
  const selectors = unique([
    ...arrayOfStrings(value.selectors),
    ...(typeof value.selector === "string" ? [value.selector] : [])
  ]);

  if (selectors.length === 0) {
    throw new Error(`${label} must include at least one selector`);
  }

  return selectors;
}

function requiredStringValue(value: unknown, label: string): string {
  const parsed = stringValue(value);

  if (parsed === undefined) {
    throw new Error(`${label} must be a non-empty string`);
  }

  return parsed;
}

function requiredNumberValue(value: unknown, label: string): number {
  const parsed = numberValue(value);

  if (parsed === undefined) {
    throw new Error(`${label} must be a number`);
  }

  return parsed;
}

function portFromUrl(url: string | undefined): number | undefined {
  if (url === undefined) {
    return undefined;
  }

  try {
    const parsed = new URL(url);

    if (parsed.port.length > 0) {
      return Number(parsed.port);
    }

    if (parsed.protocol === "http:") {
      return 80;
    }

    if (parsed.protocol === "https:") {
      return 443;
    }

    return undefined;
  } catch {
    return undefined;
  }
}

function startupReadyUiSmokePath(root: string): string {
  return join(root, "startup", "ui-smoke.yaml");
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

function stringValue(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();

  return trimmed.length === 0 ? undefined : trimmed;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }

  return value;
}

function arrayOfStrings(value: unknown): string[] {
  if (typeof value === "string") {
    const trimmed = value.trim();

    return trimmed.length === 0 ? [] : [trimmed];
  }

  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
