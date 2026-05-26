import type { Task } from "@runstead/core";

import {
  CODEX_DIRECT_WORKER_KIND,
  type CodexDirectPendingPatchResume,
  type CodexDirectTransport
} from "./codex-direct-worker.js";
import {
  localAgentTaskBaseUrl,
  localAgentTaskModel,
  localAgentTaskProvider,
  localAgentTaskWorker,
  type LocalAgentWorkerKind
} from "./local-agent-task-input.js";
import { readLocalAgentApprovedPendingPatch } from "./local-agent-resume.js";
import {
  createModelProviderRuntime,
  resolveModelProviderModel
} from "./model-provider-runtime.js";

export interface ResolvedLocalAgentRuntime {
  worker: LocalAgentWorkerKind;
  model?: string;
  modelProviderResourceId?: string;
  modelProviderNetworkDomains?: string[];
  transport?: CodexDirectTransport;
  pendingPatchResume?: CodexDirectPendingPatchResume;
}

export async function resolveLocalAgentRuntime(input: {
  cwd: string;
  stateDb: string;
  task: Task;
  transport?: CodexDirectTransport;
  now?: Date;
}): Promise<ResolvedLocalAgentRuntime> {
  const worker = localAgentTaskWorker(input.task);

  if (
    worker !== CODEX_DIRECT_WORKER_KIND &&
    worker !== "codex_cli" &&
    worker !== "claude_code"
  ) {
    throw new Error(
      "Local agent task execution currently supports codex_direct, codex_cli, or claude_code"
    );
  }

  if (worker !== CODEX_DIRECT_WORKER_KIND) {
    const model = localAgentTaskModel(input.task);

    return {
      worker,
      ...(model === undefined ? {} : { model })
    };
  }

  const explicitProvider = localAgentTaskProvider(input.task);
  const explicitModel = localAgentTaskModel(input.task);
  const explicitBaseUrl = localAgentTaskBaseUrl(input.task);
  const pendingPatchResume = readLocalAgentApprovedPendingPatch(
    input.stateDb,
    input.task
  );
  const runtime =
    input.transport === undefined
      ? await createModelProviderRuntime({
          cwd: input.cwd,
          ...(explicitProvider === undefined ? {} : { explicitProvider }),
          ...(explicitModel === undefined ? {} : { explicitModel }),
          ...(explicitBaseUrl === undefined ? {} : { explicitBaseUrl }),
          ...(input.now === undefined ? {} : { now: input.now })
        })
      : await resolveModelProviderModel({
          cwd: input.cwd,
          ...(explicitProvider === undefined ? {} : { explicitProvider }),
          ...(explicitModel === undefined ? {} : { explicitModel }),
          ...(explicitBaseUrl === undefined ? {} : { explicitBaseUrl })
        });

  return {
    worker,
    model: runtime.model,
    modelProviderResourceId: runtime.modelProviderResourceId,
    modelProviderNetworkDomains: runtime.networkDomains,
    transport:
      input.transport ??
      (runtime as Awaited<ReturnType<typeof createModelProviderRuntime>>).transport,
    ...(pendingPatchResume === undefined ? {} : { pendingPatchResume })
  };
}
