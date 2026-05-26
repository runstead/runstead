import type { WorkerRun } from "@runstead/core";
import type { RuntimeVerificationStatus } from "@runstead/runtime";

import type {
  CodexResponsesInputItem,
  CodexResponsesRequest
} from "../codex-responses-transport.js";
import {
  ToolActionApprovalRequiredError,
  ToolActionDeniedError
} from "../governed-action.js";

import {
  buildCodexDirectInstructions,
  codexDirectToolDefinitions,
  codexDirectVerificationStatus,
  codexDirectWarningOptions,
  completedWorkerResult,
  CodexDirectModelRetryExhaustedError,
  CodexDirectModelTimeoutError,
  finalizeBudgetExceededWorkerResult,
  modelRetryExhaustedInterruption,
  modelTimeoutInterruption,
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
    if (error instanceof ToolActionApprovalRequiredError) {
      return completedWorkerResult({
        options: input.options,
        workerRun: input.workerRun,
        status: "waiting_approval",
        exitCode: 2,
        summary: error.message,
        toolCalls: executedToolCalls,
        failedToolCalls,
        verification: verification(),
        ...codexDirectWarningOptions(input.warnings),
        approval: {
          id: error.approval.id,
          actionId: error.approval.actionId,
          policyDecisionId: error.policyDecision.id,
          reason: error.approval.reason
        }
      });
    }

    if (error instanceof ToolActionDeniedError) {
      return completedWorkerResult({
        options: input.options,
        workerRun: input.workerRun,
        status: "blocked",
        exitCode: 3,
        summary: error.message,
        toolCalls: executedToolCalls,
        failedToolCalls,
        verification: verification(),
        ...codexDirectWarningOptions(input.warnings)
      });
    }

    if (error instanceof CodexDirectModelTimeoutError) {
      return completedWorkerResult({
        options: input.options,
        workerRun: input.workerRun,
        status: "interrupted",
        exitCode: 124,
        summary: error.message,
        toolCalls: executedToolCalls,
        failedToolCalls,
        verification: verification(),
        ...codexDirectWarningOptions([
          ...(input.warnings ?? []),
          "Codex Direct model request timed out; the task is recoverable with runstead resume."
        ]),
        interruption: modelTimeoutInterruption(input.options, error)
      });
    }

    if (error instanceof CodexDirectModelRetryExhaustedError) {
      return completedWorkerResult({
        options: input.options,
        workerRun: input.workerRun,
        status: "failed",
        exitCode: 1,
        summary: error.message,
        toolCalls: executedToolCalls,
        failedToolCalls,
        verification: verification(),
        ...codexDirectWarningOptions([
          ...(input.warnings ?? []),
          "Codex Direct model request retry budget exhausted; the task is recoverable with runstead resume."
        ]),
        interruption: modelRetryExhaustedInterruption(input.options, error)
      });
    }

    return completedWorkerResult({
      options: input.options,
      workerRun: input.workerRun,
      status: "failed",
      exitCode: 1,
      summary: error instanceof Error ? error.message : String(error),
      toolCalls: executedToolCalls,
      failedToolCalls,
      verification: verification(),
      ...codexDirectWarningOptions(input.warnings)
    });
  }
}
