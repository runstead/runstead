import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { requireRunsteadStateDb } from "./runstead-root.js";

export interface GenerateStartupUiTestScaffoldOptions {
  cwd?: string;
  url?: string;
  testPath?: string;
  flow?: string;
  expectText?: string[];
  now?: Date;
}

export interface GenerateStartupUiTestScaffoldResult {
  root: string;
  testPath: string;
  guidePath: string;
  url: string;
  flow: string;
  expectText: string[];
  nextCommands: string[];
}

export async function generateStartupUiTestScaffold(
  options: GenerateStartupUiTestScaffoldOptions = {}
): Promise<GenerateStartupUiTestScaffoldResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const state = await requireRunsteadStateDb(cwd);
  const url = options.url ?? "http://localhost:3000";
  const flow = options.flow ?? "critical UI smoke flow";
  const expectText = dedupeNonEmpty(options.expectText ?? []);
  const testPath = resolve(cwd, options.testPath ?? "tests/runstead-ui-smoke.test.mjs");
  const guidePath = join(state.root, "startup", "ui-test-scaffold.md");
  const nextCommands = [
    "RUNSTEAD_UI_URL=http://localhost:3000 node --test tests/runstead-ui-smoke.test.mjs",
    'runstead startup launch ui-validate --execute --viewport desktop --expect-text "<expected text>"'
  ];

  await mkdir(dirname(testPath), { recursive: true });
  await mkdir(dirname(guidePath), { recursive: true });
  await writeFile(testPath, formatUiSmokeTest({ url, flow, expectText }), "utf8");
  await writeFile(
    guidePath,
    formatUiTestScaffoldGuide({
      generatedAt: (options.now ?? new Date()).toISOString(),
      testPath,
      url,
      flow,
      expectText,
      nextCommands
    }),
    "utf8"
  );

  return {
    root: state.root,
    testPath,
    guidePath,
    url,
    flow,
    expectText,
    nextCommands
  };
}

export function formatStartupUiTestScaffold(
  result: GenerateStartupUiTestScaffoldResult
): string {
  return [
    "Startup UI test scaffold",
    `Test: ${result.testPath}`,
    `Guide: ${result.guidePath}`,
    `URL: ${result.url}`,
    `Flow: ${result.flow}`,
    `Expected text: ${result.expectText.length === 0 ? "none" : result.expectText.join(", ")}`,
    "",
    "Next commands:",
    ...result.nextCommands.map((command) => `- ${command}`)
  ].join("\n");
}

function formatUiSmokeTest(input: {
  url: string;
  flow: string;
  expectText: string[];
}): string {
  return `${[
    "import assert from 'node:assert/strict';",
    "import { test } from 'node:test';",
    "",
    `const DEFAULT_URL = ${JSON.stringify(input.url)};`,
    `const EXPECTED_TEXT = ${JSON.stringify(input.expectText, null, 2)};`,
    "",
    `test(${JSON.stringify(`Runstead UI smoke: ${input.flow}`)}, async () => {`,
    "  const url = process.env.RUNSTEAD_UI_URL ?? DEFAULT_URL;",
    "  const response = await fetch(url);",
    "  assert.equal(response.ok, true, `Expected ${url} to return a successful response`);",
    "  const html = await response.text();",
    "  assert.match(html, /<html|<main|<body/i, 'Expected rendered DOM-like HTML');",
    "  for (const text of EXPECTED_TEXT) {",
    "    assert.equal(html.includes(text), true, `Expected UI text not found: ${text}`);",
    "  }",
    "});",
    ""
  ].join("\n")}\n`;
}

function formatUiTestScaffoldGuide(input: {
  generatedAt: string;
  testPath: string;
  url: string;
  flow: string;
  expectText: string[];
  nextCommands: string[];
}): string {
  return [
    "# Runstead UI Test Scaffold",
    "",
    `Generated: ${input.generatedAt}`,
    `Test path: ${input.testPath}`,
    `Default URL: ${input.url}`,
    `Flow: ${input.flow}`,
    "",
    "## Expected Text",
    "",
    input.expectText.length === 0
      ? "- none configured yet"
      : input.expectText.map((text) => `- ${text}`).join("\n"),
    "",
    "## Commands",
    "",
    ...input.nextCommands.map((command) => `- ${command}`),
    ""
  ].join("\n");
}

function dedupeNonEmpty(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
