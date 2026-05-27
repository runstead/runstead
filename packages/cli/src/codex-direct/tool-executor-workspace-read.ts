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
import type { CodexDirectPendingToolResumeContext } from "./patch-actions.js";
import type { CodexDirectToolCall } from "./tool-types.js";
import {
  workspaceFileInfoToolOptions,
  workspaceListFilesToolOptions,
  workspacePackageScriptsToolOptions,
  workspaceReadFileToolOptions,
  workspaceReadManyFilesToolOptions,
  workspaceSearchTextToolOptions,
  workspaceTreeToolOptions
} from "./workspace-read-tool-options.js";
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
        await runGovernedListFiles(workspaceListFilesToolOptions(options))
      );
    case "search_text":
      return JSON.stringify(
        await runGovernedSearchText(workspaceSearchTextToolOptions(options))
      );
    case "read_file":
      return JSON.stringify(
        await readGovernedWorkspaceFile(workspaceReadFileToolOptions(options)).then(
          (result) => result.value
        )
      );
    case "read_many_files":
      return JSON.stringify(
        await runGovernedReadManyFiles(workspaceReadManyFilesToolOptions(options))
      );
    case "file_info":
      return JSON.stringify(
        await runGovernedFileInfo(workspaceFileInfoToolOptions(options))
      );
    case "tree":
      return JSON.stringify(await runGovernedTree(workspaceTreeToolOptions(options)));
    case "package_scripts":
      return JSON.stringify(
        await runGovernedPackageScripts(workspacePackageScriptsToolOptions(options))
      );
    default:
      return undefined;
  }
}
