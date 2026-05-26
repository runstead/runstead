export function todoInputSelectors(): string[] {
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

export function addTodoSelectors(): string[] {
  return [
    "[data-testid='add-todo']",
    "[data-testid='add-task']",
    "button[type='submit']",
    "button:has-text('Add')",
    "text=Add"
  ];
}

export function todoSearchSelectors(): string[] {
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
