import type { WorkerRun } from "@runstead/core";

import {
  runGovernedDiffSummary,
  runGovernedGitLog,
  runGovernedGitRead,
  runGovernedGitShow
} from "./governed-tools.js";
import {
  gitDiffSummaryToolOptions,
  gitDiffToolCommand,
  gitLogToolOptions,
  gitShowToolOptions
} from "./git-tool-options.js";
import type { CodexDirectPendingToolResumeContext } from "./patch-actions.js";
import type { CodexDirectToolCall } from "./tool-types.js";
import type { CodexDirectWorkerOptions } from "./worker-types.js";

export async function executeCodexDirectGitTool(
  options: CodexDirectWorkerOptions & {
    workerRun: WorkerRun;
    toolCall: CodexDirectToolCall;
    resumeContext?: CodexDirectPendingToolResumeContext;
  }
): Promise<string | undefined> {
  switch (options.toolCall.name) {
    case "git_status":
      return JSON.stringify(await runGovernedGitRead(options, "git status --short"));
    case "git_diff":
      return JSON.stringify(
        await runGovernedGitRead(options, gitDiffToolCommand(options))
      );
    case "git_log":
      return JSON.stringify(await runGovernedGitLog(gitLogToolOptions(options)));
    case "git_show":
      return JSON.stringify(await runGovernedGitShow(gitShowToolOptions(options)));
    case "diff_summary":
      return JSON.stringify(
        await runGovernedDiffSummary(gitDiffSummaryToolOptions(options))
      );
    default:
      return undefined;
  }
}
