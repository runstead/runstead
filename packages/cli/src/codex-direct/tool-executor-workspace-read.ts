import type { WorkerRun } from "@runstead/core";

import { readGovernedWorkspaceFile } from "../filesystem-proxy.js";
import {
  runGovernedFileInfo,
  runGovernedListFiles,
  runGovernedPackageScripts,
  runGovernedReadManyFiles,
  runGovernedSearchText,
  runGovernedTree
} from "./governed-tools.js";
import { governedToolOptions } from "./policy-actions.js";
import type { CodexDirectPendingToolResumeContext } from "./patch-actions.js";
import {
  optionalField,
  optionalNonNegativeInteger,
  optionalPositiveInteger,
  optionalString,
  optionalStringArray,
  requiredString,
  requiredStringArray
} from "./tool-argument-values.js";
import type { CodexDirectToolCall } from "./tool-types.js";
import type { CodexDirectWorkerOptions } from "./worker-types.js";

export async function executeCodexDirectWorkspaceReadTool(
  options: CodexDirectWorkerOptions & {
    workerRun: WorkerRun;
    toolCall: CodexDirectToolCall;
    resumeContext?: CodexDirectPendingToolResumeContext;
  }
): Promise<string | undefined> {
  switch (options.toolCall.name) {
    case "list_files":
      return JSON.stringify(
        await runGovernedListFiles({
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
        })
      );
    case "search_text":
      return JSON.stringify(
        await runGovernedSearchText({
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
        })
      );
    case "read_file":
      return JSON.stringify(
        await readGovernedWorkspaceFile({
          ...governedToolOptions(options),
          path: requiredString(options.toolCall.arguments.path, "path")
        }).then((result) => result.value)
      );
    case "read_many_files":
      return JSON.stringify(
        await runGovernedReadManyFiles({
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
        })
      );
    case "file_info":
      return JSON.stringify(
        await runGovernedFileInfo({
          ...options,
          path: optionalString(options.toolCall.arguments.path) ?? ".",
          ...optionalField(
            "maxEntries",
            optionalPositiveInteger(options.toolCall.arguments.maxEntries)
          )
        })
      );
    case "tree":
      return JSON.stringify(
        await runGovernedTree({
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
        })
      );
    case "package_scripts":
      return JSON.stringify(
        await runGovernedPackageScripts({
          ...options,
          path: optionalString(options.toolCall.arguments.path) ?? "."
        })
      );
    default:
      return undefined;
  }
}
