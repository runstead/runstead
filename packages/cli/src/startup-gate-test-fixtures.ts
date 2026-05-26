import { lstat, readFile, readdir } from "node:fs/promises";
import { extname, join } from "node:path";

import { parse as parseYaml } from "yaml";
import { z } from "zod";

import type { StartupVerdict, StartupVerdictTarget } from "./startup-verdict.js";

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
    targetReadiness?:
      | {
          local?: StartupGateFixtureExpectedDecision | undefined;
          staging?: StartupGateFixtureExpectedDecision | undefined;
          production?: StartupGateFixtureExpectedDecision | undefined;
        }
      | undefined;
  };
}

export async function loadStartupGateFixture(
  fixturePath: string
): Promise<StartupGateFixture> {
  const raw = await readFile(fixturePath, "utf8");
  const parsed: unknown = parseYaml(raw);
  const fixture = StartupGateFixtureSchema.parse(parsed);

  return fixture;
}

export async function collectStartupGateFixturePaths(
  fixturePath: string
): Promise<string[]> {
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
