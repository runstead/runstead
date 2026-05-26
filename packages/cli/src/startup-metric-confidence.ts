export const STARTUP_METRIC_SOURCE_CLASSES = [
  "synthetic_smoke",
  "founder_manual",
  "analytics_real_user"
] as const;

export type StartupMetricSourceClass = (typeof STARTUP_METRIC_SOURCE_CLASSES)[number];

export interface StartupMetricConfidenceProfile {
  sourceClass: StartupMetricSourceClass;
  confidence: number;
  launchWeight: number;
  realUserData: boolean;
}

export interface ResolveStartupMetricConfidenceProfileInput {
  source: string;
  sourceClass?: string;
  confidence?: string | number;
  sourceRefs?: string[];
  sources?: { kind?: string; uri?: string }[];
}

export function resolveStartupMetricConfidenceProfile(
  input: ResolveStartupMetricConfidenceProfileInput
): StartupMetricConfidenceProfile {
  const sourceClass =
    input.sourceClass === undefined
      ? inferStartupMetricSourceClass({
          source: input.source,
          sourceRefs: input.sourceRefs ?? [],
          sources: input.sources ?? []
        })
      : parseStartupMetricSourceClass(input.sourceClass);

  return startupMetricConfidenceProfile(
    sourceClass,
    input.confidence === undefined ? undefined : parseMetricConfidence(input.confidence)
  );
}

export function parseStartupMetricSourceClass(value: string): StartupMetricSourceClass {
  if (STARTUP_METRIC_SOURCE_CLASSES.includes(value as StartupMetricSourceClass)) {
    return value as StartupMetricSourceClass;
  }

  throw new Error(
    `Unsupported metric source class ${value}. Expected one of: ${STARTUP_METRIC_SOURCE_CLASSES.join(", ")}`
  );
}

export function inferStartupMetricSourceClass(input: {
  source: string;
  sourceRefs: string[];
  sources: { kind?: string; uri?: string }[];
}): StartupMetricSourceClass {
  const text = [
    input.source,
    ...input.sourceRefs,
    ...input.sources.flatMap((source) => [source.kind ?? "", source.uri ?? ""])
  ]
    .join(" ")
    .toLowerCase();

  if (
    text.includes("smoke") ||
    text.includes("synthetic") ||
    text.includes("local") ||
    text.includes("browser_ui")
  ) {
    return "synthetic_smoke";
  }

  if (
    text.includes("posthog") ||
    text.includes("amplitude") ||
    text.includes("mixpanel") ||
    text.includes("segment") ||
    text.includes("analytics")
  ) {
    return "analytics_real_user";
  }

  return "founder_manual";
}

export function startupMetricConfidenceProfile(
  sourceClass: StartupMetricSourceClass,
  explicitConfidence?: number
): StartupMetricConfidenceProfile {
  const defaults: Record<StartupMetricSourceClass, StartupMetricConfidenceProfile> = {
    synthetic_smoke: {
      sourceClass,
      confidence: 0.35,
      launchWeight: 0.25,
      realUserData: false
    },
    founder_manual: {
      sourceClass,
      confidence: 0.55,
      launchWeight: 0.5,
      realUserData: false
    },
    analytics_real_user: {
      sourceClass,
      confidence: 0.9,
      launchWeight: 1,
      realUserData: true
    }
  };
  const profile = defaults[sourceClass];

  return {
    ...profile,
    ...(explicitConfidence === undefined ? {} : { confidence: explicitConfidence })
  };
}

export function parseMetricConfidence(value: string | number): number {
  const confidence = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new Error("--confidence must be a number from 0 to 1");
  }

  return confidence;
}
