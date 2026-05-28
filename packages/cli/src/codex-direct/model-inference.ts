import type { WorkerRun } from "@runstead/core";

import type {
  CodexResponsesRequest,
  CodexResponsesResult
} from "../codex-responses-transport.js";
import { runGovernedToolAction } from "../governed-action.js";
import { runModelRequestWithHeartbeat } from "./model-request-heartbeat.js";
import { codexDirectModelRequestOutput } from "./model-request-output.js";
import { codexDirectModelRequestSettings } from "./model-request-settings.js";
import { modelRequestTimeoutMs } from "./model-request-timeout.js";
import { governedToolOptions, modelInferenceAction } from "./policy-actions.js";
import type {
  CodexDirectModelRequestPhase,
  CodexDirectWorkerOptions
} from "./worker-types.js";

export async function runGovernedModelInference(
  options: CodexDirectWorkerOptions & {
    workerRun: WorkerRun;
    request: CodexResponsesRequest;
    phase?: CodexDirectModelRequestPhase;
  }
): Promise<CodexResponsesResult> {
  const phase = options.phase ?? "conversation";

  return runGovernedToolAction({
    ...governedToolOptions(options),
    action: modelInferenceAction({
      task: options.task,
      model: options.model,
      ...(options.modelProviderResourceId === undefined
        ? {}
        : { providerResourceId: options.modelProviderResourceId }),
      ...(options.modelProviderNetworkDomains === undefined
        ? {}
        : { networkDomains: options.modelProviderNetworkDomains })
    }),
    run: async () => {
      const settings = codexDirectModelRequestSettings(options);
      const modelRequest = await runModelRequestWithHeartbeat({
        database: options.database,
        task: options.task,
        workerRun: options.workerRun,
        phase,
        timeoutMs: modelRequestTimeoutMs(options, phase),
        ...settings,
        request: () => options.transport.createResponse(options.request)
      });
      const value = modelRequest.value;

      return {
        value,
        output: codexDirectModelRequestOutput({
          model: options.model,
          phase,
          value,
          elapsedMs: modelRequest.elapsedMs,
          heartbeatCount: modelRequest.heartbeatCount,
          attempts: modelRequest.attempts,
          retryCount: modelRequest.retryCount
        })
      };
    }
  }).then((result) => result.value);
}
