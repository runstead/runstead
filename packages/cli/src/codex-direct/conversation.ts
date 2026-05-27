import type { WorkerRun } from "@runstead/core";
import type { RuntimeVerificationStatus } from "@runstead/runtime";

import type {
  CodexResponsesInputItem,
  CodexResponsesRequest
} from "../codex-responses-transport.js";

import { codexDirectConversationErrorResult } from "./conversation-error-result.js";
import {
  buildCodexDirectInstructions,
  codexDirectToolDefinitions,
  codexDirectVerificationStatus,
  codexDirectWarningOptions,
  completedWorkerResult,
  finalizeBudgetExceededWorkerResult,
  parseCodexDirectToolCall,
  recordCodexDirectVerifierResult,
  runCodexDirectTool,
  runGovernedModelInference
} from "./tool-router.js";
import type { CodexDirectWorkerOptions, CodexDirectWorkerResult } from "./worker.js";

export async function runCodexDirectConversation(input: {
  options: CodexDirectWorkerOptions;
  workerRun: WorkerRun;
  messages: CodexResponsesInputItem[];
  maxTurns: number;
  executedToolCalls: number;
  failedToolCalls: number;
  warnings?: string[];
}): Promise<CodexDirectWorkerResult> {
  let executedToolCalls = input.executedToolCalls;
  let failedToolCalls = input.failedToolCalls;
  const verifierResults = new Map<string, RuntimeVerificationStatus>();
  const verification = (): RuntimeVerificationStatus =>
    codexDirectVerificationStatus(input.options.task, verifierResults);

  try {
    for (let turn = 0; turn < input.maxTurns; turn += 1) {
      const request: CodexResponsesRequest = {
        model: input.options.model,
        instructions: buildCodexDirectInstructions(input.options),
        input: input.messages,
        tools: codexDirectToolDefinitions(),
        sessionId: input.options.task.id
      };
      const response = await runGovernedModelInference({
        ...input.options,
        workerRun: input.workerRun,
        request
      });

      if (response.toolCalls.length === 0) {
        const summary = response.outputText || "Codex Direct worker completed.";

        return completedWorkerResult({
          options: input.options,
          workerRun: input.workerRun,
          status: "completed",
          exitCode: 0,
          summary,
          toolCalls: executedToolCalls,
          failedToolCalls,
          verification: verification(),
          ...codexDirectWarningOptions(input.warnings)
        });
      }

      for (const rawToolCall of response.toolCalls) {
        if (
          input.options.maxToolCalls !== undefined &&
          executedToolCalls >= input.options.maxToolCalls
        ) {
          return finalizeBudgetExceededWorkerResult({
            options: input.options,
            workerRun: input.workerRun,
            messages: input.messages,
            reason: "tool_calls",
            maxTurns: input.maxTurns,
            toolCalls: executedToolCalls,
            failedToolCalls,
            verification: verification(),
            ...codexDirectWarningOptions(input.warnings)
          });
        }

        const toolCall = parseCodexDirectToolCall(rawToolCall);
        const toolResult = await runCodexDirectTool({
          ...input.options,
          workerRun: input.workerRun,
          toolCall,
          resumeContext: {
            messages: input.messages,
            toolCall: {
              type: "function_call",
              call_id: rawToolCall.id,
              name: rawToolCall.name,
              arguments: rawToolCall.arguments
            }
          }
        });

        executedToolCalls += 1;
        if (toolResult.failed) {
          failedToolCalls += 1;
        }
        recordCodexDirectVerifierResult({
          toolCall,
          toolResult,
          verifierResults
        });
        input.messages.push({
          type: "function_call",
          call_id: rawToolCall.id,
          name: rawToolCall.name,
          arguments: rawToolCall.arguments
        });
        input.messages.push({
          type: "function_call_output",
          call_id: rawToolCall.id,
          output: toolResult.output
        });

        if (
          input.options.maxFailedToolCalls !== undefined &&
          failedToolCalls >= input.options.maxFailedToolCalls
        ) {
          return finalizeBudgetExceededWorkerResult({
            options: input.options,
            workerRun: input.workerRun,
            messages: input.messages,
            reason: "failed_tool_calls",
            maxTurns: input.maxTurns,
            toolCalls: executedToolCalls,
            failedToolCalls,
            verification: verification(),
            ...codexDirectWarningOptions(input.warnings)
          });
        }
      }
    }

    return finalizeBudgetExceededWorkerResult({
      options: input.options,
      workerRun: input.workerRun,
      messages: input.messages,
      reason: "turns",
      maxTurns: input.maxTurns,
      toolCalls: executedToolCalls,
      failedToolCalls,
      verification: verification(),
      ...codexDirectWarningOptions(input.warnings)
    });
  } catch (error) {
    return codexDirectConversationErrorResult({
      error,
      options: input.options,
      workerRun: input.workerRun,
      toolCalls: executedToolCalls,
      failedToolCalls,
      verification: verification(),
      ...codexDirectWarningOptions(input.warnings)
    });
  }
}
