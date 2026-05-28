import { governedToolOptions } from "./policy-actions.js";
import {
  optionalField,
  optionalNonNegativeInteger,
  optionalPositiveInteger,
  optionalString,
  optionalStringArray,
  requiredString,
  requiredStringArray
} from "./tool-argument-values.js";
import type { WorkspaceReadToolOptions } from "./workspace-read-tool-option-types.js";

export function workspaceListFilesToolOptions(options: WorkspaceReadToolOptions) {
  return {
    ...options,
    ...optionalField(
      "glob",
      optionalStringArray(options.toolCall.arguments.glob, "glob")
    ),
    ...optionalField(
      "exclude",
      optionalStringArray(options.toolCall.arguments.exclude, "exclude")
    ),
    ...optionalField(
      "maxResults",
      optionalPositiveInteger(options.toolCall.arguments.maxResults)
    ),
    includeDirs: options.toolCall.arguments.includeDirs === true
  };
}

export function workspaceSearchTextToolOptions(options: WorkspaceReadToolOptions) {
  return {
    ...options,
    query: requiredString(options.toolCall.arguments.query, "query"),
    regex: options.toolCall.arguments.regex === true,
    ...optionalField(
      "glob",
      optionalStringArray(options.toolCall.arguments.glob, "glob")
    ),
    caseSensitive: options.toolCall.arguments.caseSensitive === true,
    ...optionalField(
      "contextLines",
      optionalNonNegativeInteger(
        options.toolCall.arguments.contextLines,
        "contextLines"
      )
    ),
    ...optionalField(
      "maxMatches",
      optionalPositiveInteger(options.toolCall.arguments.maxMatches)
    ),
    ...optionalField(
      "maxBytesPerFile",
      optionalPositiveInteger(options.toolCall.arguments.maxBytesPerFile)
    )
  };
}

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
