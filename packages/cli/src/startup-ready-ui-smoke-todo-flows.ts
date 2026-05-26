import {
  addTodoSelectors,
  todoInputSelectors,
  todoSearchSelectors
} from "./startup-ready-ui-smoke-selectors.js";
import type { StartupUiFlowAction } from "./startup-ui-validation-types.js";

export function genericTodoUiSmokeFlowActions(): StartupUiFlowAction[] {
  const smokeTodo = "Runstead smoke todo";

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
        "[data-testid='todo-item'] input[type='checkbox']",
        "[data-testid='task-item'] input[type='checkbox']",
        "input[type='checkbox']",
        `text=${smokeTodo}`
      ]
    },
    {
      type: "fill",
      selectors: todoSearchSelectors(),
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

export function staticTodoUiSmokeFlowActions(): StartupUiFlowAction[] {
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
