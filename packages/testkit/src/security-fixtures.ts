import { lstat, readFile } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REQUIRED_SECURITY_FIXTURE_IDS = [
  "js-lint-failure",
  "python-test-failure",
  "dependency-update-required",
  "forbidden-prod-config-change",
  "prompt-injection-in-issue",
  "memory-pollution-attempt",
  "secret-exfiltration-attempt",
  "malicious-ci-log"
] as const;

export type SecurityFixtureId = (typeof REQUIRED_SECURITY_FIXTURE_IDS)[number];

export interface SecurityFixtureManifest {
  id: string;
  threat: string;
  untrustedInput: string;
  expectedControls: string[];
  mustNot: string[];
}

export interface SecurityFixture {
  id: string;
  root: string;
  manifestPath: string;
  inputPath: string;
  input: string;
  manifest: SecurityFixtureManifest;
}

interface RawSecurityFixtureManifest {
  id?: unknown;
  threat?: unknown;
  untrusted_input?: unknown;
  expected_controls?: unknown;
  must_not?: unknown;
}

export function securityFixturesRoot(): string {
  return fileURLToPath(new URL("../../../fixtures", import.meta.url));
}

export async function loadSecurityFixture(
  id: string,
  options: { fixturesRoot?: string } = {}
): Promise<SecurityFixture> {
  assertSecurityFixtureId(id);

  const root = resolve(options.fixturesRoot ?? securityFixturesRoot(), id);
  const manifestPath = join(root, "fixture.json");
  const manifest = parseSecurityFixtureManifest(
    JSON.parse(await readFile(manifestPath, "utf8")) as RawSecurityFixtureManifest
  );

  if (manifest.id !== id) {
    throw new Error(`Security fixture id mismatch: expected ${id}, got ${manifest.id}`);
  }

  const inputPath = resolveFixtureInputPath(root, manifest.untrustedInput);
  const inputStat = await lstat(inputPath);

  if (!inputStat.isFile()) {
    throw new Error(`Security fixture input is not a regular file: ${inputPath}`);
  }

  return {
    id,
    root,
    manifestPath,
    inputPath,
    input: await readFile(inputPath, "utf8"),
    manifest
  };
}

export async function loadSecurityFixtures(
  ids: readonly string[] = REQUIRED_SECURITY_FIXTURE_IDS,
  options: { fixturesRoot?: string } = {}
): Promise<SecurityFixture[]> {
  return Promise.all(ids.map((id) => loadSecurityFixture(id, options)));
}

function parseSecurityFixtureManifest(
  raw: RawSecurityFixtureManifest
): SecurityFixtureManifest {
  const id = stringField(raw, "id");
  const threat = stringField(raw, "threat");
  const untrustedInput = stringField(raw, "untrusted_input");
  const expectedControls = stringArrayField(raw, "expected_controls");
  const mustNot = stringArrayField(raw, "must_not");

  if (!/^[a-z][a-z0-9-]*$/.test(id)) {
    throw new Error(`Invalid security fixture id: ${id}`);
  }

  if (!/^[a-z_]+$/.test(threat)) {
    throw new Error(`Invalid security fixture threat: ${threat}`);
  }

  if (!expectedControls.includes("treat_as_untrusted")) {
    throw new Error(`Security fixture ${id} must declare treat_as_untrusted`);
  }

  if (mustNot.length === 0) {
    throw new Error(`Security fixture ${id} must declare must_not controls`);
  }

  return {
    id,
    threat,
    untrustedInput,
    expectedControls,
    mustNot
  };
}

function resolveFixtureInputPath(root: string, untrustedInput: string): string {
  const inputPath = resolve(root, untrustedInput);
  const relativePath = relative(root, inputPath);

  if (
    basename(inputPath) !== untrustedInput ||
    relativePath.startsWith("..") ||
    isAbsolute(relativePath)
  ) {
    throw new Error(`Security fixture input escapes fixture root: ${untrustedInput}`);
  }

  return inputPath;
}

function assertSecurityFixtureId(id: string): asserts id is SecurityFixtureId {
  if (!REQUIRED_SECURITY_FIXTURE_IDS.includes(id as SecurityFixtureId)) {
    throw new Error(`Unknown security fixture: ${id}`);
  }
}

function stringField(raw: RawSecurityFixtureManifest, field: string): string {
  const value = raw[field as keyof RawSecurityFixtureManifest];

  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Security fixture field ${field} must be a non-empty string`);
  }

  return value;
}

function stringArrayField(raw: RawSecurityFixtureManifest, field: string): string[] {
  const value = raw[field as keyof RawSecurityFixtureManifest];

  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    !value.every((item): item is string => typeof item === "string" && item.length > 0)
  ) {
    throw new Error(`Security fixture field ${field} must be a non-empty string array`);
  }

  return value;
}
