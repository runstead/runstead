import { DashboardOperatorApiHttpError } from "./dashboard-operator-api-http.js";
import type { StartupGateStage } from "./startup-evidence.js";

export function requiredStringBodyField(value: unknown, field: string): string {
  const parsed = stringBodyField(value);

  if (parsed === undefined) {
    throw new DashboardOperatorApiHttpError(
      400,
      "missing_field",
      `Request body field ${field} is required.`
    );
  }

  return parsed;
}

export function stringBodyField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

export function stringArrayBodyField(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export function optionalStartupGateStage(value: unknown): StartupGateStage | undefined {
  const stage = stringBodyField(value);

  if (stage === undefined) {
    return undefined;
  }

  if (stage === "idea" || stage === "mvp" || stage === "launch" || stage === "scale") {
    return stage;
  }

  throw new DashboardOperatorApiHttpError(
    400,
    "invalid_gate",
    `Unsupported startup gate stage: ${stage}`
  );
}
