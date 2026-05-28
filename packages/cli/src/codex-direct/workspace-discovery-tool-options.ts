import {
  optionalField,
  optionalNonNegativeInteger,
  optionalPositiveInteger,
  optionalStringArray,
  requiredString
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
