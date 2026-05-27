import type {
  StartupCompleteProductCriterion,
  StartupCompleteProductStatus
} from "./startup-complete-check-types.js";

export function startupCompleteProductEvidenceSummary(
  status: StartupCompleteProductStatus
): string {
  return `Startup complete product check: ${status}`;
}

export function startupCompleteProductEvidenceContent(input: {
  domain: string;
  status: StartupCompleteProductStatus;
  criteria: StartupCompleteProductCriterion[];
}): string {
  return JSON.stringify(
    {
      domain: input.domain,
      status: input.status,
      criteria: input.criteria.map((criterion) => ({
        id: criterion.id,
        status: criterion.status
      }))
    },
    null,
    2
  );
}
