import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { initRunstead } from "./init.js";
import {
  attachLocalAgentVerifierEvidence,
  createLocalAgentTask,
  runLocalAgentTask
} from "./local-agent.js";
import { discoverVerifierCommands } from "./verifier-discovery.js";
import type { CodexDirectTransport } from "./codex-direct-worker.js";
import type { CodexResponsesToolCall } from "./codex-responses-transport.js";

const execFileAsync = promisify(execFile);
const fixtureRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../fixtures/local-agent-smoke"
);

describe("local agent smoke fixtures", () => {
  it("covers the fixture repo shapes and verifier discovery", async () => {
    const manifest = JSON.parse(
      await readFile(join(fixtureRoot, "manifest.json"), "utf8")
    ) as SmokeManifest;
    const fixtureIds = manifest.fixtures.map((fixture) => fixture.id).sort();

    expect(fixtureIds).toEqual([
      "failing-test",
      "js-ts-package",
      "pnpm-monorepo",
      "python-repo"
    ]);

    await expect(
      discoverVerifierCommands({
        cwd: join(fixtureRoot, "js-ts-package")
      })
    ).resolves.toEqual([
      { name: "test", command: "npm test" },
      { name: "lint", command: "npm run lint" },
      { name: "typecheck", command: "npm run typecheck" }
    ]);

    await expect(
      discoverVerifierCommands({
        cwd: join(fixtureRoot, "pnpm-monorepo")
      })
    ).resolves.toEqual([
      { name: "test", command: "pnpm test" },
      { name: "lint", command: "pnpm lint" },
      { name: "typecheck", command: "pnpm typecheck" }
    ]);
  });

  it("inspects a Python fixture through real workspace reads", async () => {
    const workspace = await copySmokeFixture("python-repo");

    try {
      await initRunstead({ cwd: workspace, profile: "trusted-local" });
      const created = await createLocalAgentTask({
        cwd: workspace,
        prompt: "Inspect the Python package entrypoint and test shape.",
        worker: "codex_direct",
        model: "fake-codex",
        mode: "read-only",
        maxTurns: 4,
        maxToolCalls: 4
      });
      const result = await runLocalAgentTask({
        cwd: workspace,
        taskId: created.task.id,
        transport: toolThenSummaryTransport(
          [
            readFileCall("call_read_pyproject", "pyproject.toml"),
            readFileCall(
              "call_read_python_entrypoint",
              "src/runstead_sample/__init__.py"
            )
          ],
          "Inspected the Python fixture entrypoint and tests."
        )
      });

      expect(result.status).toBe("completed");
      expect(result.workerResult).toMatchObject({
        worker: "codex_direct",
        toolCalls: 2
      });
      expect(result.summary).toContain("Python fixture");
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("reviews a staged JS/TS fixture diff through real git diff", async () => {
    const workspace = await copySmokeFixture("js-ts-package");

    try {
      await initializeGitRepository(workspace);
      await initRunstead({ cwd: workspace, profile: "trusted-local" });
      await writeFile(
        join(workspace, "src", "index.ts"),
        [
          "export interface GreetingOptions {",
          "  name: string;",
          "}",
          "",
          "export function greeting(options: GreetingOptions): string {",
          "  return `hello ${options.name.trim()}`;",
          "}",
          ""
        ].join("\n"),
        "utf8"
      );
      await git(workspace, ["add", "src/index.ts"]);
      const created = await createLocalAgentTask({
        cwd: workspace,
        prompt: "Review only the staged diff.",
        worker: "codex_direct",
        model: "fake-codex",
        mode: "read-only",
        gitDiffStaged: true,
        maxTurns: 4,
        maxToolCalls: 4
      });
      const result = await runLocalAgentTask({
        cwd: workspace,
        taskId: created.task.id,
        transport: toolThenSummaryTransport(
          [
            {
              id: "call_staged_diff",
              name: "git_diff",
              arguments: JSON.stringify({ staged: true })
            }
          ],
          "Reviewed the staged JS/TS fixture diff."
        )
      });

      expect(result.status).toBe("completed");
      expect(result.workerResult).toMatchObject({
        worker: "codex_direct",
        toolCalls: 1
      });
      expect(result.summary).toContain("staged JS/TS fixture diff");
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("repairs a failing fixture test with real verifier evidence", async () => {
    const workspace = await copySmokeFixture("failing-test");
    const verifierCommand = nodeScriptCommand("test/sum.test.mjs");

    try {
      await initializeGitRepository(workspace);
      await initRunstead({ cwd: workspace, profile: "trusted-local" });
      await allowLocalAgentEditPolicyForTest(workspace, verifierCommand);
      const created = await createLocalAgentTask({
        cwd: workspace,
        prompt: "Fix the failing sum test.",
        worker: "codex_direct",
        model: "fake-codex",
        mode: "repair",
        checkpoint: true,
        verifierCommands: [
          {
            name: "test",
            command: verifierCommand
          }
        ],
        maxTurns: 4,
        maxToolCalls: 4
      });
      const verifierEvidence = await attachLocalAgentVerifierEvidence({
        cwd: workspace,
        taskId: created.task.id
      });

      expect(verifierEvidence.commandResults[0]).toMatchObject({
        verifier: "test",
        exitCode: 1
      });

      const result = await runLocalAgentTask({
        cwd: workspace,
        taskId: created.task.id,
        transport: toolThenSummaryTransport(
          [
            {
              id: "call_fix_sum",
              name: "write_file",
              arguments: JSON.stringify({
                path: "src/sum.mjs",
                content: [
                  "export function sum(left, right) {",
                  "  return left + right;",
                  "}",
                  ""
                ].join("\n"),
                createDirs: false
              })
            }
          ],
          "Fixed the failing sum test."
        )
      });

      expect(result.status).toBe("completed");
      expect(result.checkpoint?.id).toMatch(/^chk_/);
      expect(result.verifierResults?.[0]).toMatchObject({
        verifier: "test",
        exitCode: 0
      });
      await expect(readFile(join(workspace, "src", "sum.mjs"), "utf8")).resolves.toBe(
        ["export function sum(left, right) {", "  return left + right;", "}", ""].join(
          "\n"
        )
      );
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});

interface SmokeManifest {
  fixtures: { id: string; language: string; workflows: string[] }[];
}

function readFileCall(id: string, path: string): CodexResponsesToolCall {
  return {
    id,
    name: "read_file",
    arguments: JSON.stringify({ path })
  };
}

function toolThenSummaryTransport(
  toolCalls: CodexResponsesToolCall[],
  summary: string
): CodexDirectTransport {
  let requests = 0;

  return {
    createResponse() {
      requests += 1;

      if (requests === 1) {
        return Promise.resolve({
          id: "resp_smoke_tools",
          status: "completed",
          outputText: "",
          toolCalls,
          finishReason: "tool_calls",
          outputItems: []
        });
      }

      return Promise.resolve({
        id: "resp_smoke_summary",
        status: "completed",
        outputText: summary,
        toolCalls: [],
        finishReason: "stop",
        outputItems: []
      });
    }
  };
}

async function copySmokeFixture(id: string): Promise<string> {
  const workspace = await mkdtemp(join(tmpdir(), `runstead-smoke-${id}-`));

  await cp(join(fixtureRoot, id), workspace, { recursive: true });

  return workspace;
}

async function initializeGitRepository(workspace: string): Promise<void> {
  await git(workspace, ["init", "-b", "main"]);
  await git(workspace, ["config", "user.name", "Runstead Smoke"]);
  await git(workspace, ["config", "user.email", "smoke@example.com"]);
  await git(workspace, ["add", "."]);
  await git(workspace, ["commit", "--no-gpg-sign", "-m", "baseline"]);
}

async function git(workspace: string, args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd: workspace });
}

function nodeScriptCommand(scriptPath: string): string {
  return `${JSON.stringify(process.execPath)} ${scriptPath}`;
}

async function allowLocalAgentEditPolicyForTest(
  workspace: string,
  verifierCommand: string
): Promise<void> {
  const policyPath = join(workspace, ".runstead", "policies", "repo-maintenance.yaml");
  const raw = await readFile(policyPath, "utf8");
  const writeAllowed = raw.replace(
    "          - checkpoint.restore\n",
    "          - checkpoint.restore\n          - filesystem.write\n"
  );

  await writeFile(
    policyPath,
    addVerifierPolicyRule(writeAllowed, verifierCommand),
    "utf8"
  );
}

function addVerifierPolicyRule(policyYaml: string, verifierCommand: string): string {
  const verifierPattern = JSON.stringify(`^${escapeRegex(verifierCommand)}$`);
  const verifierRule = `  - id: allow_local_agent_smoke_verifier
    when:
      action_type: shell.exec
      command:
        matches_any:
          - ${verifierPattern}
    decision: allow
    risk: low

`;

  return policyYaml.replace("rules:\n", `rules:\n\n${verifierRule}`);
}

function escapeRegex(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}
