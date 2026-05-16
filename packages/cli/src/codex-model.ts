import {
  codexModelsFromEnvironment,
  listCodexModels,
  readCodexModelCache,
  type CodexModel
} from "./codex-auth.js";
import { readRunsteadConfigValue } from "./config.js";

export type CodexModelSource = "explicit" | "config" | "environment" | "cache" | "live";

export interface ResolveCodexModelResult {
  model: string;
  source: CodexModelSource;
}

export interface ResolveCodexModelOptions {
  cwd?: string;
  explicitModel?: string;
  readCachedModels?: typeof readCodexModelCache;
  listModels?: typeof listCodexModels;
}

export async function resolveCodexModel(
  options: ResolveCodexModelOptions = {}
): Promise<ResolveCodexModelResult> {
  const explicit = normalizeModelId(options.explicitModel);

  if (explicit !== undefined) {
    return {
      model: explicit,
      source: "explicit"
    };
  }

  const configured = await readRunsteadConfigValue({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    key: "codex.model"
  });

  if (configured !== undefined) {
    return {
      model: configured,
      source: "config"
    };
  }

  const environment = chooseDefaultCodexModel(codexModelsFromEnvironment());

  if (environment !== undefined) {
    return {
      model: environment,
      source: "environment"
    };
  }

  const cached = chooseDefaultCodexModel(
    await (options.readCachedModels ?? readCodexModelCache)()
  );

  if (cached !== undefined) {
    return {
      model: cached,
      source: "cache"
    };
  }

  try {
    const live = chooseDefaultCodexModel(
      await (options.listModels ?? listCodexModels)()
    );

    if (live !== undefined) {
      return {
        model: live,
        source: "live"
      };
    }
  } catch (error) {
    throw new Error(defaultModelResolutionError(error), { cause: error });
  }

  throw new Error(defaultModelResolutionError());
}

export function chooseDefaultCodexModel(
  models: readonly Pick<CodexModel, "id" | "contextWindow">[]
): string | undefined {
  const candidates = uniqueModels(models);

  if (candidates.length === 0) {
    return undefined;
  }

  return candidates.sort(compareCodexModelCandidates)[0]?.id;
}

function compareCodexModelCandidates(
  left: Pick<CodexModel, "id" | "contextWindow">,
  right: Pick<CodexModel, "id" | "contextWindow">
): number {
  const scoreDelta = modelScore(right) - modelScore(left);

  if (scoreDelta !== 0) {
    return scoreDelta;
  }

  const contextDelta = (right.contextWindow ?? 0) - (left.contextWindow ?? 0);

  if (contextDelta !== 0) {
    return contextDelta;
  }

  return left.id.localeCompare(right.id);
}

function modelScore(model: Pick<CodexModel, "id">): number {
  const id = model.id.toLowerCase();
  const version = versionScore(id);

  return (
    (id.includes("codex") ? 1_000_000 : 0) +
    (id.includes("gpt") ? 100_000 : 0) +
    version -
    (id.includes("mini") ? 1_000 : 0)
  );
}

function versionScore(value: string): number {
  const parts = value.match(/\d+/g)?.map((item) => Number(item)) ?? [];

  return (
    (parts[0] ?? 0) * 10_000 +
    (parts[1] ?? 0) * 100 +
    (parts[2] ?? 0)
  );
}

function uniqueModels(
  models: readonly Pick<CodexModel, "id" | "contextWindow">[]
): Pick<CodexModel, "id" | "contextWindow">[] {
  const seen = new Set<string>();
  const unique: Pick<CodexModel, "id" | "contextWindow">[] = [];

  for (const model of models) {
    const id = normalizeModelId(model.id);

    if (id === undefined || seen.has(id)) {
      continue;
    }

    seen.add(id);
    unique.push({
      id,
      ...(model.contextWindow === undefined
        ? {}
        : { contextWindow: model.contextWindow })
    });
  }

  return unique;
}

function normalizeModelId(value: string | undefined): string | undefined {
  const normalized = value?.trim();

  return normalized === undefined || normalized.length === 0 ? undefined : normalized;
}

function defaultModelResolutionError(cause?: unknown): string {
  const causeMessage =
    cause instanceof Error && cause.message.length > 0 ? ` Last error: ${cause.message}` : "";

  return [
    "No Codex model selected.",
    "Pass --model <codex-model>, run `runstead config set codex.model <codex-model>`, or run `runstead codex models --refresh` so Runstead can choose an available Codex model.",
    causeMessage
  ].join(" ");
}
