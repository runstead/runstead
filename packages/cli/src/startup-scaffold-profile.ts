export type StartupScaffoldTemplate = "static-todo";
export type StartupAppType = "local-first-web";

export interface StartupScaffoldProfile {
  template?: StartupScaffoldTemplate;
  appType?: StartupAppType;
  id: string;
  title: string;
  appOwnedPaths: string[];
  promptLines: string[];
}

export function resolveStartupScaffoldProfile(input: {
  template?: StartupScaffoldTemplate;
  appType?: StartupAppType;
}): StartupScaffoldProfile | undefined {
  if (input.template === undefined && input.appType === undefined) {
    return undefined;
  }

  if (input.template === "static-todo") {
    return {
      template: input.template,
      appType: input.appType ?? "local-first-web",
      id: "static-todo",
      title: "Static local-first todo app",
      appOwnedPaths: [
        "index.html",
        "styles.css",
        "app.js",
        "server.js",
        "scripts/*.js"
      ],
      promptLines: [
        "Build a polished static local-first todo application.",
        "Use plain HTML, CSS, and browser JavaScript unless the repo already has a framework.",
        "Provide test, lint, typecheck, and build scripts that work without adding dependencies.",
        "Persist todos in localStorage and support add, complete, edit, delete, clear-completed, search/filter, and count states.",
        "Expose stable UI smoke selectors: data-testid=new-todo-input, add-todo, todo-item, todo-toggle, todo-search, edit-todo, todo-edit-input, save-todo, delete-todo, filter-active, filter-completed, filter-all, clear-completed.",
        "Keep the mobile layout free of overlapping todo controls.",
        "Serve locally on port 3000 with an npm start command when no framework dev server exists."
      ]
    };
  }

  const appType = input.appType ?? "local-first-web";

  return {
    appType,
    id: appType,
    title: "Local-first web app",
    appOwnedPaths: [
      "index.html",
      "styles.css",
      "app.js",
      "server.js",
      "src/**",
      "app/**",
      "components/**",
      "public/**",
      "scripts/*.js"
    ],
    promptLines: [
      "Build a local-first web MVP with durable browser-state behavior.",
      "Keep the implementation install-free unless the repo already has dependencies.",
      "Provide test, lint, typecheck, build, and start scripts that Runstead can execute.",
      "Expose stable UI smoke selectors for the primary create/read/update flow.",
      "Serve locally on port 3000 with an npm start command when no framework dev server exists."
    ]
  };
}

export function parseStartupScaffoldTemplate(
  value: string
): StartupScaffoldTemplate {
  if (value === "static-todo") {
    return value;
  }

  throw new Error("--app-template must be static-todo");
}

export function parseStartupAppType(value: string): StartupAppType {
  if (value === "local-first-web") {
    return value;
  }

  throw new Error("--app-type must be local-first-web");
}
