import { validateDomainPackDir } from "./validator.js";

export interface DomainPackMaturityCheck {
  id: string;
  label: string;
  passed: boolean;
  score: number;
  maxScore: number;
  evidence: string[];
}

export interface DomainPackMaturityResult {
  root: string;
  passed: boolean;
  score: number;
  requiredScore: number;
  checks: DomainPackMaturityCheck[];
}

const DEFAULT_REQUIRED_SCORE = 0.85;
const MINIMUM_GATE_THRESHOLD_COUNT = 3;

export async function assessDomainPackMaturity(
  root: string,
  options: { requiredScore?: number } = {}
): Promise<DomainPackMaturityResult> {
  const validation = await validateDomainPackDir(root);
  const domain = validation.domain;
  const requiredScore = options.requiredScore ?? DEFAULT_REQUIRED_SCORE;
  const checks: DomainPackMaturityCheck[] = [
    maturityCheck({
      id: "validation",
      label: "Domain pack validates without structural errors",
      passed: validation.valid,
      score: 20,
      evidence: validation.valid
        ? ["validator status valid"]
        : validation.issues.map((issue) => issue.code)
    }),
    maturityCheck({
      id: "schema-versioning",
      label: "Schema version and upgrade migrations are declared",
      passed:
        domain?.schemaVersion !== undefined && (domain.migrations?.length ?? 0) > 0,
      score: 15,
      evidence: [
        `schema_version=${domain?.schemaVersion ?? "missing"}`,
        `migrations=${domain?.migrations?.length ?? 0}`
      ]
    }),
    maturityCheck({
      id: "repo-templates",
      label: "Repo type templates cover multiple domain surfaces",
      passed: (domain?.repoTemplates?.length ?? 0) >= 3,
      score: 15,
      evidence: domain?.repoTemplates?.map((template) => template.id) ?? []
    }),
    maturityCheck({
      id: "gate-thresholds",
      label: "Configurable gate thresholds cover a multi-stage lifecycle",
      passed:
        Object.keys(domain?.gateThresholds ?? {}).length >=
        MINIMUM_GATE_THRESHOLD_COUNT,
      score: 15,
      evidence: Object.keys(domain?.gateThresholds ?? {})
    }),
    maturityCheck({
      id: "report-sections",
      label: "Report sections can be generated from pack metadata",
      passed: (domain?.reportSections?.length ?? 0) >= 3,
      score: 10,
      evidence: domain?.reportSections?.map((section) => section.id) ?? []
    }),
    maturityCheck({
      id: "eval-quality",
      label: "Eval quality threshold is tied to benchmark acceptance contracts",
      passed:
        domain?.evalQuality?.requiredContracts.every((contract) =>
          validation.evals.some((evaluation) =>
            evaluation.acceptanceContracts.includes(contract)
          )
        ) === true,
      score: 15,
      evidence: [
        `minimum_score=${domain?.evalQuality?.minimumScore ?? "missing"}`,
        ...(domain?.evalQuality?.requiredContracts ?? [])
      ]
    }),
    maturityCheck({
      id: "evidence-evaluators",
      label: "Evidence contracts have domain-specific evaluator coverage",
      passed:
        evidenceRequirements(domain).length > 0 &&
        evidenceRequirements(domain).every((requirement) =>
          (domain?.evidenceRequirementEvaluators ?? []).some(
            (evaluator) => evaluator.requirement === requirement
          )
        ),
      score: 10,
      evidence: [
        `requirements=${evidenceRequirements(domain).length}`,
        `evaluators=${domain?.evidenceRequirementEvaluators?.length ?? 0}`
      ]
    }),
    maturityCheck({
      id: "fixture-coverage",
      label: "Fixture and eval coverage exercise pack behavior",
      passed: validation.fixtures.length >= 3 && validation.evals.length >= 3,
      score: 10,
      evidence: [
        `fixtures=${validation.fixtures.length}`,
        `evals=${validation.evals.length}`
      ]
    })
  ];
  const total = checks.reduce((sum, check) => sum + check.score, 0);
  const max = checks.reduce((sum, check) => sum + check.maxScore, 0);
  const score = max === 0 ? 0 : total / max;

  return {
    root: validation.root,
    passed: score >= requiredScore && checks.every((check) => check.passed),
    score,
    requiredScore,
    checks
  };
}

function evidenceRequirements(
  domain: Awaited<ReturnType<typeof validateDomainPackDir>>["domain"]
): string[] {
  return [
    ...new Set(
      (domain?.evidenceContracts ?? []).flatMap((contract) => [
        ...contract.outputs,
        ...contract.completionCriteria
      ])
    )
  ];
}

export function formatDomainPackMaturityResult(
  result: DomainPackMaturityResult
): string {
  return [
    "Runstead domain pack maturity assessment",
    `Path: ${result.root}`,
    `Status: ${result.passed ? "passed" : "needs work"}`,
    `Score: ${formatScore(result.score)} / required ${formatScore(result.requiredScore)}`,
    ...result.checks.map(
      (check) =>
        `  ${check.passed ? "PASS" : "FAIL"} ${check.id}: ${check.label} (${check.score}/${check.maxScore})${
          check.evidence.length === 0 ? "" : ` evidence=${check.evidence.join(", ")}`
        }`
    )
  ].join("\n");
}

function maturityCheck(input: {
  id: string;
  label: string;
  passed: boolean;
  score: number;
  evidence: string[];
}): DomainPackMaturityCheck {
  return {
    id: input.id,
    label: input.label,
    passed: input.passed,
    score: input.passed ? input.score : 0,
    maxScore: input.score,
    evidence: input.evidence
  };
}

function formatScore(value: number): string {
  return `${Math.round(value * 100)}%`;
}
