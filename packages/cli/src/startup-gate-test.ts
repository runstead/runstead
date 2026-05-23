import { lstat, readFile, readdir } from "node:fs/promises";
import { basename, extname, join } from "node:path";

import { parse as parseYaml } from "yaml";
import { z } from "zod";

import {
  evaluateStartupVerdict,
  type StartupVerdict,
  type StartupVerdictDecision,
  type StartupVerdictTarget
} from "./startup-verdict.js";

const StartupVerdictSchema = z.enum([
  "not_evaluated",
  "local_launch_ready",
  "local_launch_blocked",
  "staging_launch_ready",
  "staging_launch_blocked",
  "public_launch_ready",
  "public_launch_blocked"
]);

const StartupTargetSchema = z.enum(["local", "staging", "production"]);

const StartupGateExpectedDecisionSchema = z.object({
  verdict: StartupVerdictSchema.optional(),
  canLaunch: z.boolean().optional(),
  blockers: z.array(z.string()).optional(),
  warnings: z.array(z.string()).optional(),
  evidenceRefs: z.array(z.string()).optional()
});

const StartupGateFixtureSchema = z.object({
  schemaVersion: z.literal(1).optional(),
  name: z.string().optional(),
  description: z.string().optional(),
  input: z.object({
    target: StartupTargetSchema,
    stage: z.string().optional(),
    phases: z
      .array(
        z.object({
          id: z.string(),
          title: z.string(),
          status: z.string(),
          evidenceIds: z.array(z.string()).optional(),
          blockers: z.array(z.string()).optional()
        })
      )
      .default([]),
    evidenceTiers: z.array(z.string()).default([]),
    evidenceTypes: z.array(z.string()).default([]),
    staleEvidenceRefs: z.array(z.string()).default([]),
    supersededEvidenceRefs: z.array(z.string()).default([])
  }),
  expect: StartupGateExpectedDecisionSchema.extend({
    targetReadiness: z
      .object({
        local: StartupGateExpectedDecisionSchema.optional(),
        staging: StartupGateExpectedDecisionSchema.optional(),
        production: StartupGateExpectedDecisionSchema.optional()
      })
      .optional()
  })
});

export interface StartupGateFixtureExpectedDecision {
  verdict?: StartupVerdict | undefined;
  canLaunch?: boolean | undefined;
  blockers?: string[] | undefined;
  warnings?: string[] | undefined;
  evidenceRefs?: string[] | undefined;
}

export interface StartupGateFixturePhase {
  id: string;
  title: string;
  status: string;
  evidenceIds?: string[] | undefined;
  blockers?: string[] | undefined;
}

export interface StartupGateFixtureInput {
  target: StartupVerdictTarget;
  stage?: string | undefined;
  phases: StartupGateFixturePhase[];
  evidenceTiers: string[];
  evidenceTypes: string[];
  staleEvidenceRefs: string[];
  supersededEvidenceRefs: string[];
}

export interface StartupGateFixture {
  schemaVersion?: 1 | undefined;
  name?: string | undefined;
  description?: string | undefined;
  input: StartupGateFixtureInput;
  expect: StartupGateFixtureExpectedDecision & {
    targetReadiness?: {
      local?: StartupGateFixtureExpectedDecision | undefined;
      staging?: StartupGateFixtureExpectedDecision | undefined;
      production?: StartupGateFixtureExpectedDecision | undefined;
    } | undefined;
  };
}

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

async function loadStartupGateFixture(
  fixturePath: string
): Promise<StartupGateFixture> {
  const raw = await readFile(fixturePath, "utf8");
  const parsed = parseYaml(raw);
  const fixture = StartupGateFixtureSchema.parse(parsed);

  return fixture;
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

async function collectStartupGateFixturePaths(fixturePath: string): Promise<string[]> {
  const stats = await lstat(fixturePath);

  if (stats.isFile()) {
    return isStartupGateFixtureFile(fixturePath) ? [fixturePath] : [];
  }

  if (!stats.isDirectory()) {
    return [];
  }

  const entries = await readdir(fixturePath, { withFileTypes: true });
  const nested = await Promise.all(
    entries
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((entry) => collectStartupGateFixturePaths(join(fixturePath, entry.name)))
  );

  return nested.flat();
}

function isStartupGateFixtureFile(filePath: string): boolean {
  return [".json", ".yaml", ".yml"].includes(extname(filePath));
}

function arraysEqual(left: string[], right: string[]): boolean {
  return (
    left.length === right.length && left.every((value, index) => value === right[index])
  );
}
