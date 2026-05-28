import { governedToolOptions } from "./policy-actions.js";
import {
  optionalField,
  optionalPositiveInteger,
  optionalString,
  requiredString,
  requiredStringArray
} from "./tool-argument-values.js";
import type { WorkspaceReadToolOptions } from "./workspace-read-tool-option-types.js";

export {
  workspaceListFilesToolOptions,
  workspaceSearchTextToolOptions
} from "./workspace-discovery-tool-options.js";

export function workspaceReadFileToolOptions(options: WorkspaceReadToolOptions) {
  return {
    ...governedToolOptions(options),
    path: requiredString(options.toolCall.arguments.path, "path")
  };
}

export function workspaceReadManyFilesToolOptions(options: WorkspaceReadToolOptions) {
  return {
    ...options,
    paths: requiredStringArray(options.toolCall.arguments.paths, "paths"),
    ...optionalField(
      "maxBytesPerFile",
      optionalPositiveInteger(options.toolCall.arguments.maxBytesPerFile)
    ),
    ...optionalField(
      "maxTotalBytes",
      optionalPositiveInteger(options.toolCall.arguments.maxTotalBytes)
    )
  };
}

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
