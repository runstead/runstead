import { basename } from "node:path";

import {
  evaluateStartupVerdict,
  type StartupVerdict,
  type StartupVerdictDecision,
  type StartupVerdictTarget
} from "./startup-verdict.js";
import {
  collectStartupGateFixturePaths,
  loadStartupGateFixture,
  type StartupGateFixture,
  type StartupGateFixtureExpectedDecision,
  type StartupGateFixtureInput
} from "./startup-gate-test-fixtures.js";

export type {
  StartupGateFixture,
  StartupGateFixtureExpectedDecision,
  StartupGateFixtureInput,
  StartupGateFixturePhase
} from "./startup-gate-test-fixtures.js";

export interface StartupGateFixtureTestResult {
  fixturePath: string;
  name: string;
  passed: boolean;
  verdict: StartupVerdict;
  target: StartupVerdictTarget;
  blockers: string[];
  errors: string[];
}

export interface StartupGateFixtureTestSummary {
  fixturePath: string;
  total: number;
  passed: number;
  failed: number;
  results: StartupGateFixtureTestResult[];
}

export async function testStartupGateFixtures(input: {
  fixturePath: string;
}): Promise<StartupGateFixtureTestSummary> {
  const fixturePaths = await collectStartupGateFixturePaths(input.fixturePath);
  const results = [];

  for (const fixturePath of fixturePaths) {
    results.push(await testStartupGateFixture({ fixturePath }));
  }

  const passed = results.filter((result) => result.passed).length;

  return {
    fixturePath: input.fixturePath,
    total: results.length,
    passed,
    failed: results.length - passed,
    results
  };
}

export async function testStartupGateFixture(input: {
  fixturePath: string;
}): Promise<StartupGateFixtureTestResult> {
  const fixture = await loadStartupGateFixture(input.fixturePath);
  const result = evaluateStartupVerdict(toStartupVerdictInput(fixture.input));
  const errors = compareStartupGateFixture({
    fixture,
    actual: result
  });

  return {
    fixturePath: input.fixturePath,
    name: fixture.name ?? basename(input.fixturePath),
    passed: errors.length === 0,
    verdict: result.verdict,
    target: result.target,
    blockers: result.blockers,
    errors
  };
}

function toStartupVerdictInput(input: StartupGateFixtureInput) {
  return {
    target: input.target,
    phases: input.phases.map((phase) => ({
      id: phase.id,
      title: phase.title,
      status: phase.status,
      ...(phase.evidenceIds === undefined ? {} : { evidenceIds: phase.evidenceIds }),
      ...(phase.blockers === undefined ? {} : { blockers: phase.blockers })
    })),
    evidenceTiers: input.evidenceTiers,
    evidenceTypes: input.evidenceTypes,
    staleEvidenceRefs: input.staleEvidenceRefs,
    supersededEvidenceRefs: input.supersededEvidenceRefs
  };
}

export function formatStartupGateFixtureTestSummary(
  summary: StartupGateFixtureTestSummary
): string {
  const lines = [
    "Startup gate fixture replay",
    `Fixture path: ${summary.fixturePath}`,
    `Passed: ${summary.passed}/${summary.total}`
  ];

  for (const result of summary.results) {
    lines.push(
      `- ${result.passed ? "PASS" : "FAIL"} ${result.name} target=${result.target} verdict=${result.verdict} blockers=${result.blockers.length}`
    );
    for (const error of result.errors) {
      lines.push(`  - ${error}`);
    }
  }

  return lines.join("\n");
}

function compareStartupGateFixture(input: {
  fixture: StartupGateFixture;
  actual: ReturnType<typeof evaluateStartupVerdict>;
}): string[] {
  const errors = [
    ...compareExpectedDecision({
      label: "requested target",
      expected: input.fixture.expect,
      actual: input.actual
    })
  ];

  for (const target of ["local", "staging", "production"] as const) {
    const expected = input.fixture.expect.targetReadiness?.[target];

    if (expected === undefined) {
      continue;
    }

    errors.push(
      ...compareExpectedDecision({
        label: `${target} target`,
        expected,
        actual: input.actual.targetReadiness[target]
      })
    );
  }

  return errors;
}

function compareExpectedDecision(input: {
  label: string;
  expected: StartupGateFixtureExpectedDecision;
  actual: StartupVerdictDecision;
}): string[] {
  const errors = [];

  if (
    input.expected.verdict !== undefined &&
    input.expected.verdict !== input.actual.verdict
  ) {
    errors.push(
      `${input.label} expected verdict ${input.expected.verdict}, got ${input.actual.verdict}`
    );
  }

  if (
    input.expected.canLaunch !== undefined &&
    input.expected.canLaunch !== input.actual.canLaunch
  ) {
    errors.push(
      `${input.label} expected canLaunch ${input.expected.canLaunch}, got ${input.actual.canLaunch}`
    );
  }

  if (
    input.expected.blockers !== undefined &&
    !arraysEqual(input.expected.blockers, input.actual.blockers)
  ) {
    errors.push(
      `${input.label} expected blockers ${JSON.stringify(input.expected.blockers)}, got ${JSON.stringify(input.actual.blockers)}`
    );
  }

  if (
    input.expected.warnings !== undefined &&
    !arraysEqual(input.expected.warnings, input.actual.warnings)
  ) {
    errors.push(
      `${input.label} expected warnings ${JSON.stringify(input.expected.warnings)}, got ${JSON.stringify(input.actual.warnings)}`
    );
  }

  if (
    input.expected.evidenceRefs !== undefined &&
    !arraysEqual(input.expected.evidenceRefs, input.actual.evidenceRefs)
  ) {
    errors.push(
      `${input.label} expected evidenceRefs ${JSON.stringify(input.expected.evidenceRefs)}, got ${JSON.stringify(input.actual.evidenceRefs)}`
    );
  }

  return errors;
}

function arraysEqual(left: string[], right: string[]): boolean {
  return (
    left.length === right.length && left.every((value, index) => value === right[index])
  );
}
