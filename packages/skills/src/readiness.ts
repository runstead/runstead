import type { SkillPackage, SkillPlatform } from "./skill-package.js";

export type SkillReadinessStatus =
  | "ready"
  | "missing_requirements"
  | "fallback_suppressed"
  | "platform_unsupported";

export interface SkillReadinessVerdict {
  skill: string;
  status: SkillReadinessStatus;
  missingEnv: string[];
  missingConnectors: string[];
  missingTools: string[];
  missingWorkers: string[];
  suppressedByConnectors: string[];
  suppressedByTools: string[];
  platform: SkillPlatform;
  reason: string;
}

export interface EvaluateSkillReadinessOptions {
  skill: SkillPackage;
  env?: Record<string, string | undefined>;
  platform?: SkillPlatform;
  availableConnectors?: string[];
  availableTools?: string[];
  availableWorkers?: string[];
}

export function evaluateSkillReadiness(
  options: EvaluateSkillReadinessOptions
): SkillReadinessVerdict {
  const readiness = options.skill.readiness;
  const env = options.env ?? process.env;
  const platform = options.platform ?? currentSkillPlatform();
  const availableConnectors = new Set(options.availableConnectors ?? []);
  const availableTools = new Set(options.availableTools ?? options.skill.allowedTools);
  const availableWorkers = new Set(options.availableWorkers ?? []);

  if (readiness.platforms.length > 0 && !readiness.platforms.includes(platform)) {
    return verdict({
      skill: options.skill.name,
      status: "platform_unsupported",
      platform,
      reason: `skill supports ${readiness.platforms.join(", ")} but current platform is ${platform}`
    });
  }

  const suppressedByConnectors = readiness.fallbackForConnectors.filter((connector) =>
    availableConnectors.has(connector)
  );
  const suppressedByTools = readiness.fallbackForTools.filter((tool) =>
    availableTools.has(tool)
  );

  if (suppressedByConnectors.length > 0 || suppressedByTools.length > 0) {
    return verdict({
      skill: options.skill.name,
      status: "fallback_suppressed",
      platform,
      suppressedByConnectors,
      suppressedByTools,
      reason: [
        suppressedByConnectors.length === 0
          ? undefined
          : `connector fallback satisfied by ${suppressedByConnectors.join(", ")}`,
        suppressedByTools.length === 0
          ? undefined
          : `tool fallback satisfied by ${suppressedByTools.join(", ")}`
      ]
        .filter((item): item is string => item !== undefined)
        .join("; ")
    });
  }

  const missingEnv = readiness.requiredEnv
    .map((entry) => entry.name)
    .filter((name) => !hasValue(env[name]));
  const missingConnectors = readiness.requiredConnectors.filter(
    (connector) => !availableConnectors.has(connector)
  );
  const missingTools = readiness.requiredTools.filter(
    (tool) => !availableTools.has(tool)
  );
  const missingWorkers = readiness.requiredWorkers.filter(
    (worker) => !availableWorkers.has(worker)
  );

  if (
    missingEnv.length > 0 ||
    missingConnectors.length > 0 ||
    missingTools.length > 0 ||
    missingWorkers.length > 0
  ) {
    return verdict({
      skill: options.skill.name,
      status: "missing_requirements",
      platform,
      missingEnv,
      missingConnectors,
      missingTools,
      missingWorkers,
      reason: formatMissingReason({
        missingEnv,
        missingConnectors,
        missingTools,
        missingWorkers
      })
    });
  }

  return verdict({
    skill: options.skill.name,
    status: "ready",
    platform,
    reason: "skill readiness requirements are satisfied"
  });
}

export function currentSkillPlatform(): SkillPlatform {
  if (process.platform === "darwin") {
    return "macos";
  }

  if (process.platform === "win32") {
    return "windows";
  }

  return "linux";
}

function verdict(input: {
  skill: string;
  status: SkillReadinessStatus;
  platform: SkillPlatform;
  missingEnv?: string[];
  missingConnectors?: string[];
  missingTools?: string[];
  missingWorkers?: string[];
  suppressedByConnectors?: string[];
  suppressedByTools?: string[];
  reason: string;
}): SkillReadinessVerdict {
  return {
    skill: input.skill,
    status: input.status,
    missingEnv: input.missingEnv ?? [],
    missingConnectors: input.missingConnectors ?? [],
    missingTools: input.missingTools ?? [],
    missingWorkers: input.missingWorkers ?? [],
    suppressedByConnectors: input.suppressedByConnectors ?? [],
    suppressedByTools: input.suppressedByTools ?? [],
    platform: input.platform,
    reason: input.reason
  };
}

function formatMissingReason(input: {
  missingEnv: string[];
  missingConnectors: string[];
  missingTools: string[];
  missingWorkers: string[];
}): string {
  return [
    formatMissing("env", input.missingEnv),
    formatMissing("connectors", input.missingConnectors),
    formatMissing("tools", input.missingTools),
    formatMissing("workers", input.missingWorkers)
  ]
    .filter((item): item is string => item !== undefined)
    .join("; ");
}

function formatMissing(label: string, values: string[]): string | undefined {
  return values.length === 0 ? undefined : `missing ${label}: ${values.join(", ")}`;
}

function hasValue(value: string | undefined): boolean {
  return value !== undefined && value.trim().length > 0;
}
