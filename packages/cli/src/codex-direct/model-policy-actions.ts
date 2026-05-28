import type { Task } from "@runstead/core";

import type { ActionEnvelope } from "../policy.js";
import { stableActionId } from "./tool-action-id.js";

export function modelInferenceAction(input: {
  task: Task;
  model: string;
  providerResourceId?: string;
  networkDomains?: string[];
}): ActionEnvelope {
  const providerResourceId = input.providerResourceId ?? "chatgpt_codex";

  return {
    actionId: stableActionId("model_inference_request", [
      input.task.id,
      providerResourceId,
      input.model
    ]),
    actionType: "model.inference.request",
    resource: {
      type: "model_provider",
      id: providerResourceId
    },
    context: {
      networkDomains: input.networkDomains ?? ["chatgpt.com"],
      sideEffects: ["network_write_external", "llm_data_egress"]
    }
  };
}
