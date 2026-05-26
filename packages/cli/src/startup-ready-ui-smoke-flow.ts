import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { resolveRunsteadRoot } from "./runstead-root.js";
import {
  addTodoSelectors,
  todoInputSelectors,
  todoSearchSelectors
} from "./startup-ready-ui-smoke-selectors.js";
import type { StartupUiFlowAction } from "./startup-ui-validation-types.js";

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

export function startupReadyMobileNoOverlapActions(): StartupUiFlowAction[] {
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
