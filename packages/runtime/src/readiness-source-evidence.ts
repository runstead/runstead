import type { ReadinessEvidenceTier, ReadinessTarget } from "./readiness-plan.js";

export interface ReadinessSourceEvidenceTierInput {
  connector: string;
  sourceKind: string;
  target?: ReadinessTarget;
}

export interface ReadinessSourceEvidenceTierStatusInput {
  status: string;
  readinessTiers: ReadinessEvidenceTier[];
}

export function readinessSourceEvidenceTiersForConnector(
  input: ReadinessSourceEvidenceTierInput
): ReadinessEvidenceTier[] {
  if (input.target === undefined || input.target === "local") {
    return [];
  }

  const tiers: ReadinessEvidenceTier[] = [];

  if (input.connector === "github_actions") {
    tiers.push("ci_verified");
  }

  if (readinessSourceConnectorIsDeployment(input)) {
    tiers.push(
      input.target === "staging" ? "staging_deployment" : "production_deployment"
    );
  }

  if (
    input.target === "production" &&
    (input.connector === "analytics" ||
      input.connector === "posthog" ||
      input.connector === "billing")
  ) {
    tiers.push("real_user_analytics");
  }

  if (input.target === "production" && input.connector === "support") {
    tiers.push("support_ticket");
  }

  if (input.target === "production" && input.connector === "dependency") {
    tiers.push("security_scan");
  }

  return uniqueReadinessEvidenceTiers(tiers);
}

export function readinessSourceEvidenceTiersForStatus(
  input: ReadinessSourceEvidenceTierStatusInput
): ReadinessEvidenceTier[] {
  return readinessSourceStatusCountsForReadiness(input.status)
    ? [...input.readinessTiers]
    : [];
}

export function readinessSourceStatusCountsForReadiness(status: string): boolean {
  const normalized = status.trim().toLowerCase();

  return normalized === "passed" || normalized === "recorded";
}

function readinessSourceConnectorIsDeployment(
  input: ReadinessSourceEvidenceTierInput
): boolean {
  return (
    input.connector === "deployment" ||
    input.connector === "vercel" ||
    input.connector === "fly" ||
    input.connector === "render" ||
    input.sourceKind.endsWith("_deployment")
  );
}

function uniqueReadinessEvidenceTiers(
  values: ReadinessEvidenceTier[]
): ReadinessEvidenceTier[] {
  return [...new Set(values)];
}
