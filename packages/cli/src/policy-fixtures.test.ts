import { readFile, readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { describe, expect, it } from "vitest";

import { loadPolicyProfileFromFile, parseActionEnvelopeYaml } from "./policy-loader.js";
import { evaluatePolicy } from "./policy.js";

const PolicyFixtureSchema = z.object({
  action: z.unknown(),
  expected: z.object({
    decision: z.enum(["allow", "deny", "require_approval"]),
    risk: z.enum(["low", "medium", "high", "critical"]),
    rule_id: z.string().min(1).optional()
  })
});

const policyPath = fileURLToPath(
  new URL(
    "../../domain-packs/packs/repo-maintenance/policies/repo-maintenance.yaml",
    import.meta.url
  )
);
const fixturesDir = fileURLToPath(new URL("../fixtures/policy/", import.meta.url));
const policy = await loadPolicyProfileFromFile(policyPath);
const fixtureFiles = (await readdir(fixturesDir))
  .filter((file) => file.endsWith(".yaml"))
  .sort();

describe("repo-maintenance policy fixtures", () => {
  for (const fixtureFile of fixtureFiles) {
    it(`matches ${basename(fixtureFile, ".yaml")}`, async () => {
      const raw = await readFile(join(fixturesDir, fixtureFile), "utf8");
      const fixture = PolicyFixtureSchema.parse(parseYaml(raw));
      const action = parseActionEnvelopeYaml(fixture.action);
      const result = evaluatePolicy({ policy, action });

      expect(result.decision).toBe(fixture.expected.decision);
      expect(result.risk).toBe(fixture.expected.risk);
      expect(result.ruleId).toBe(fixture.expected.rule_id);
    });
  }
});
