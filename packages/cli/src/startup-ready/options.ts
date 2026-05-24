import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";

import type {
  StartupFounderFlowOptions,
  StartupWorkerGovernanceProfile
} from "../startup-founder-flow.js";
import type {
  StartupReadyInteractiveAnswers,
  StartupReadyOptions,
  StartupReadyStage,
  StartupReadyTarget
} from "./types.js";
import { stringValue } from "./shared.js";

export async function collectStartupReadyInteractiveAnswers(
  options: StartupReadyOptions
): Promise<Partial<StartupReadyInteractiveAnswers>> {
  const provided = normalizeStartupReadyInteractiveAnswers(options.interactiveAnswers);

  if (options.interactive !== true) {
    return provided;
  }

  if (stdin.isTTY !== true || stdout.isTTY !== true) {
    if (Object.keys(provided).length > 0) {
      return provided;
    }

    throw new Error(
      "--interactive startup ready requires a TTY; omit --interactive for default answers"
    );
  }

  const prompts = createInterface({
    input: stdin,
    output: stdout
  });

  try {
    return normalizeStartupReadyInteractiveAnswers({
      architecturePrinciple:
        provided.architecturePrinciple ??
        (await promptStartupReadyAnswer(
          prompts,
          "Architecture principle to add to agent context"
        )),
      technicalConstraint:
        provided.technicalConstraint ??
        (await promptStartupReadyAnswer(
          prompts,
          "Technical constraint to add to agent context"
        )),
      acceptedDebt:
        provided.acceptedDebt ??
        (await promptStartupReadyAnswer(prompts, "Accepted technical debt to record")),
      activationMetric:
        provided.activationMetric ??
        (await promptStartupReadyAnswer(prompts, "Activation metric")),
      retentionMetric:
        provided.retentionMetric ??
        (await promptStartupReadyAnswer(prompts, "Retention metric")),
      day7Metric:
        provided.day7Metric ??
        (await promptStartupReadyAnswer(prompts, "Day 7 metric")),
      day30Metric:
        provided.day30Metric ??
        (await promptStartupReadyAnswer(prompts, "Day 30 metric")),
      falsePositiveMetric:
        provided.falsePositiveMetric ??
        (await promptStartupReadyAnswer(prompts, "False-positive control metric"))
    });
  } finally {
    prompts.close();
  }
}

export async function promptStartupReadyAnswer(
  prompts: ReturnType<typeof createInterface>,
  label: string
): Promise<string | undefined> {
  const answer = (await prompts.question(`${label}: `)).trim();

  return answer.length === 0 ? undefined : answer;
}

export function normalizeStartupReadyInteractiveAnswers(
  answers:
    | Partial<Record<keyof StartupReadyInteractiveAnswers, string | undefined>>
    | undefined
): Partial<StartupReadyInteractiveAnswers> {
  if (answers === undefined) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(answers)
      .map(([key, value]) => [key, stringValue(value)] as const)
      .filter((entry): entry is readonly [string, string] => entry[1] !== undefined)
  );
}

export function startupReadyInteractiveFounderFlowOptions(
  answers: Partial<StartupReadyInteractiveAnswers>
): Pick<
  StartupFounderFlowOptions,
  | "architecturePrinciples"
  | "technicalConstraints"
  | "acceptedDebt"
  | "activationMetric"
  | "retentionMetric"
  | "day7Metric"
  | "day30Metric"
  | "falsePositiveMetric"
> {
  return {
    ...optionalSingleValueArray(
      "architecturePrinciples",
      answers.architecturePrinciple
    ),
    ...optionalSingleValueArray("technicalConstraints", answers.technicalConstraint),
    ...optionalSingleValueArray("acceptedDebt", answers.acceptedDebt),
    ...optionalStringField("activationMetric", answers.activationMetric),
    ...optionalStringField("retentionMetric", answers.retentionMetric),
    ...optionalStringField("day7Metric", answers.day7Metric),
    ...optionalStringField("day30Metric", answers.day30Metric),
    ...optionalStringField("falsePositiveMetric", answers.falsePositiveMetric)
  };
}

export function optionalSingleValueArray<K extends string>(
  key: K,
  value: string | undefined
): Partial<Record<K, string[]>> {
  return value === undefined ? {} : ({ [key]: [value] } as Record<K, string[]>);
}

export function optionalStringField<K extends string>(
  key: K,
  value: string | undefined
): Partial<Record<K, string>> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, string>);
}

export function parseStartupReadyStage(value: string): StartupReadyStage {
  if (
    value === "mvp" ||
    value === "launch" ||
    value === "scale" ||
    value === "complete"
  ) {
    return value;
  }

  throw new Error(`Unsupported startup ready stage ${value}`);
}

export function parseStartupReadyTarget(value: string): StartupReadyTarget {
  if (value === "local" || value === "staging" || value === "production") {
    return value;
  }

  throw new Error(`Unsupported startup ready target ${value}`);
}

export function parseStartupReadyGovernanceProfile(
  value: string
): StartupWorkerGovernanceProfile {
  if (value === "auto" || value === "readiness" || value === "governed") {
    return value;
  }

  throw new Error(`Unsupported startup ready governance profile ${value}`);
}
