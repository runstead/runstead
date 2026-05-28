import {
  optionalField,
  optionalPositiveInteger,
  optionalString
} from "./tool-argument-values.js";
import type { WorkspaceReadToolOptions } from "./workspace-read-tool-option-types.js";

export function workspaceFileInfoToolOptions(options: WorkspaceReadToolOptions) {
  return {
    ...options,
    path: optionalString(options.toolCall.arguments.path) ?? ".",
    ...optionalField(
      "maxEntries",
      optionalPositiveInteger(options.toolCall.arguments.maxEntries)
    )
  };
}

export function workspaceTreeToolOptions(options: WorkspaceReadToolOptions) {
  return {
    ...options,
    path: optionalString(options.toolCall.arguments.path) ?? ".",
    ...optionalField(
      "maxDepth",
      optionalPositiveInteger(options.toolCall.arguments.maxDepth)
    ),
    ...optionalField(
      "maxEntries",
      optionalPositiveInteger(options.toolCall.arguments.maxEntries)
    ),
    includeFiles: options.toolCall.arguments.includeFiles !== false
  };
}

export function workspacePackageScriptsToolOptions(options: WorkspaceReadToolOptions) {
  return {
    ...options,
    path: optionalString(options.toolCall.arguments.path) ?? "."
  };
}
