import { governedToolOptions } from "./policy-actions.js";
import {
  optionalField,
  optionalPositiveInteger,
  requiredString,
  requiredStringArray
} from "./tool-argument-values.js";
import type { WorkspaceReadToolOptions } from "./workspace-read-tool-option-types.js";

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
