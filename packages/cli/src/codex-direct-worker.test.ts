import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { openRunsteadDatabase } from "@runstead/state-sqlite";
import { describe, expect, it } from "vitest";

import {
  CODEX_DIRECT_WORKER_KIND,
  codexDirectToolDefinitions,
  runCodexDirectWorker,
  type CodexDirectTransport
} from "./codex-direct-worker.js";
import type { CodexResponsesRequest } from "./codex-responses-transport.js";
import { showGoal } from "./goals.js";
import { initRunstead } from "./init.js";
import type { PolicyProfile } from "./policy.js";
import { storeCommandVerifierEvidence } from "./verifier-evidence.js";
import { listTasks } from "./tasks.js";

const execFileAsync = promisify(execFile);

describe("runCodexDirectWorker", () => {
  it("executes model-requested tools through governed action audit", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-codex-direct-"));

    try {
      const initialized = await initRunstead({
        cwd: workspace,
        createDefaultGoal: true
      });
      const database = openRunsteadDatabase(initialized.stateDb);

      try {
        const task = listTasks({ cwd: workspace }).tasks[0];

        if (task === undefined) {
          throw new Error("Expected generated task");
        }

        const goal = showGoal({ cwd: workspace, id: task.goalId }).goal;
        const transport = scriptedTransport([
          {
            outputText: "",
            toolCalls: [
              {
                id: "call_1",
                name: "write_file",
                arguments: JSON.stringify({
                  path: "src/fix.txt",
                  content: "fixed\n",
                  createDirs: true
                })
              }
            ],
            finishReason: "tool_calls",
            outputItems: []
          },
          {
            outputText: "Wrote the file.",
            toolCalls: [],
            finishReason: "stop",
            outputItems: []
          }
        ]);
        const result = await runCodexDirectWorker({
          cwd: workspace,
          stateDb: initialized.stateDb,
          database,
          policy: allowDirectToolsPolicy,
          goal,
          task,
          model: "fake-codex",
          evidenceDir: join(initialized.root, "evidence"),
          transport
        });
        const toolCalls = database
          .prepare("SELECT action_type, status FROM tool_calls ORDER BY started_at, id")
          .all() as { action_type: string; status: string }[];
        const workerRows = database
          .prepare(
            "SELECT worker_type, status FROM worker_runs ORDER BY started_at, id"
          )
          .all() as { worker_type: string; status: string }[];

        expect(result).toMatchObject({
          worker: CODEX_DIRECT_WORKER_KIND,
          status: "completed",
          exitCode: 0,
          toolCalls: 1,
          summary: "Wrote the file."
        });
        expect(await readFile(join(workspace, "src/fix.txt"), "utf8")).toBe("fixed\n");
        expect(toolCalls).toEqual([
          {
            action_type: "model.inference.request",
            status: "completed"
          },
          {
            action_type: "filesystem.write",
            status: "completed"
          },
          {
            action_type: "model.inference.request",
            status: "completed"
          }
        ]);
        expect(workerRows).toEqual([
          {
            worker_type: CODEX_DIRECT_WORKER_KIND,
            status: "completed"
          }
        ]);
        expect(transport.requests[0]?.tools?.map((tool) => tool.name)).toEqual([
          "list_files",
          "search_text",
          "read_file",
          "read_many_files",
          "file_info",
          "tree",
          "package_scripts",
          "apply_patch",
          "run_verifier",
          "write_file",
          "run_command",
          "git_status",
          "git_diff",
          "git_log",
          "git_show",
          "diff_summary",
          "read_evidence",
          "workspace_facts"
        ]);
      } finally {
        database.close();
      }
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("lists workspace files through bounded native inspection", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-codex-list-files-"));

    try {
      await mkdir(join(workspace, "src"), { recursive: true });
      await mkdir(join(workspace, "node_modules", "pkg"), { recursive: true });
      await writeFile(join(workspace, "src", "a.ts"), "export const a = 1;\n");
      await writeFile(join(workspace, "src", "b.test.ts"), "test('b', () => {});\n");
      await writeFile(join(workspace, "README.md"), "# Fixture\n");
      await writeFile(join(workspace, "node_modules", "pkg", "index.ts"), "");
      const initialized = await initRunstead({
        cwd: workspace,
        createDefaultGoal: true
      });
      const database = openRunsteadDatabase(initialized.stateDb);

      try {
        const task = listTasks({ cwd: workspace }).tasks[0];

        if (task === undefined) {
          throw new Error("Expected generated task");
        }

        const goal = showGoal({ cwd: workspace, id: task.goalId }).goal;
        const transport = scriptedTransport([
          {
            outputText: "",
            toolCalls: [
              {
                id: "call_list_files",
                name: "list_files",
                arguments: JSON.stringify({
                  glob: "**/*.ts",
                  exclude: ["**/*.test.ts"],
                  maxResults: 5
                })
              }
            ],
            finishReason: "tool_calls",
            outputItems: []
          },
          {
            outputText: "Listed files.",
            toolCalls: [],
            finishReason: "stop",
            outputItems: []
          }
        ]);
        const result = await runCodexDirectWorker({
          cwd: workspace,
          stateDb: initialized.stateDb,
          database,
          policy: allowDirectToolsPolicy,
          goal,
          task,
          model: "fake-codex",
          evidenceDir: join(initialized.root, "evidence"),
          transport
        });
        const toolCalls = database
          .prepare("SELECT action_type, status FROM tool_calls ORDER BY started_at, id")
          .all() as { action_type: string; status: string }[];
        const toolOutput = JSON.stringify(transport.requests[1]?.input);

        expect(result).toMatchObject({
          status: "completed",
          toolCalls: 1,
          summary: "Listed files."
        });
        expect(toolCalls).toEqual(
          expect.arrayContaining([
            {
              action_type: "filesystem.list",
              status: "completed"
            }
          ])
        );
        expect(toolOutput).toContain("src/a.ts");
        expect(toolOutput).not.toContain("src/b.test.ts");
        expect(toolOutput).not.toContain("node_modules/pkg/index.ts");
      } finally {
        database.close();
      }
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("searches workspace text through bounded native inspection", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-codex-search-text-"));

    try {
      await mkdir(join(workspace, "src"), { recursive: true });
      await writeFile(
        join(workspace, "src", "index.ts"),
        ["export function greet() {", "  return 'hello runstead';", "}"].join("\n")
      );
      await writeFile(join(workspace, "src", "other.ts"), "export const other = 1;\n");
      const initialized = await initRunstead({
        cwd: workspace,
        createDefaultGoal: true
      });
      const database = openRunsteadDatabase(initialized.stateDb);

      try {
        const task = listTasks({ cwd: workspace }).tasks[0];

        if (task === undefined) {
          throw new Error("Expected generated task");
        }

        const goal = showGoal({ cwd: workspace, id: task.goalId }).goal;
        const transport = scriptedTransport([
          {
            outputText: "",
            toolCalls: [
              {
                id: "call_search_text",
                name: "search_text",
                arguments: JSON.stringify({
                  query: "hello runstead",
                  glob: "src/**/*.ts",
                  contextLines: 1,
                  maxMatches: 3
                })
              }
            ],
            finishReason: "tool_calls",
            outputItems: []
          },
          {
            outputText: "Searched text.",
            toolCalls: [],
            finishReason: "stop",
            outputItems: []
          }
        ]);
        const result = await runCodexDirectWorker({
          cwd: workspace,
          stateDb: initialized.stateDb,
          database,
          policy: allowDirectToolsPolicy,
          goal,
          task,
          model: "fake-codex",
          evidenceDir: join(initialized.root, "evidence"),
          transport
        });
        const toolCalls = database
          .prepare("SELECT action_type, status FROM tool_calls ORDER BY started_at, id")
          .all() as { action_type: string; status: string }[];
        const toolOutput = JSON.stringify(transport.requests[1]?.input);

        expect(result).toMatchObject({
          status: "completed",
          toolCalls: 1,
          summary: "Searched text."
        });
        expect(toolCalls).toEqual(
          expect.arrayContaining([
            {
              action_type: "filesystem.search",
              status: "completed"
            }
          ])
        );
        expect(toolOutput).toContain("src/index.ts");
        expect(toolOutput).toContain("hello runstead");
        expect(toolOutput).toContain("export function greet");
        expect(toolOutput).not.toContain("src/other.ts");
      } finally {
        database.close();
      }
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("reads many workspace files with bounded output", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-codex-read-many-"));

    try {
      await mkdir(join(workspace, "src"), { recursive: true });
      await writeFile(join(workspace, "src", "a.txt"), "alpha\n");
      await writeFile(join(workspace, "src", "b.txt"), "bravo-charlie\n");
      const initialized = await initRunstead({
        cwd: workspace,
        createDefaultGoal: true
      });
      const database = openRunsteadDatabase(initialized.stateDb);

      try {
        const task = listTasks({ cwd: workspace }).tasks[0];

        if (task === undefined) {
          throw new Error("Expected generated task");
        }

        const goal = showGoal({ cwd: workspace, id: task.goalId }).goal;
        const transport = scriptedTransport([
          {
            outputText: "",
            toolCalls: [
              {
                id: "call_read_many",
                name: "read_many_files",
                arguments: JSON.stringify({
                  paths: ["src/a.txt", "src/missing.txt", "src/b.txt"],
                  maxBytesPerFile: 5,
                  maxTotalBytes: 8
                })
              }
            ],
            finishReason: "tool_calls",
            outputItems: []
          },
          {
            outputText: "Read files.",
            toolCalls: [],
            finishReason: "stop",
            outputItems: []
          }
        ]);
        const result = await runCodexDirectWorker({
          cwd: workspace,
          stateDb: initialized.stateDb,
          database,
          policy: allowDirectToolsPolicy,
          goal,
          task,
          model: "fake-codex",
          evidenceDir: join(initialized.root, "evidence"),
          transport
        });
        const readCall = database
          .prepare("SELECT status, output_json FROM tool_calls WHERE action_type = ?")
          .get("filesystem.read") as { status: string; output_json: string };
        const toolOutput = JSON.stringify(transport.requests[1]?.input);

        expect(result).toMatchObject({
          status: "completed",
          toolCalls: 1,
          summary: "Read files."
        });
        expect(readCall.status).toBe("completed");
        expect(readCall.output_json).toContain('"files":2');
        expect(readCall.output_json).toContain('"errors":1');
        expect(toolOutput).toContain("src/a.txt");
        expect(toolOutput).toContain("alpha");
        expect(toolOutput).toContain("src/missing.txt");
        expect(toolOutput).toContain("src/b.txt");
        expect(toolOutput).toContain('\\"truncated\\":true');
        expect(toolOutput).not.toContain("bravo-charlie");
      } finally {
        database.close();
      }
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("returns file info and directory trees through native inspection", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-codex-file-info-"));

    try {
      await mkdir(join(workspace, "src", "nested"), { recursive: true });
      await mkdir(join(workspace, "node_modules", "pkg"), { recursive: true });
      await writeFile(join(workspace, "src", "index.ts"), "export const value = 1;\n");
      await writeFile(join(workspace, "src", "nested", "deep.ts"), "export {};\n");
      await writeFile(join(workspace, "node_modules", "pkg", "ignored.ts"), "");
      const initialized = await initRunstead({
        cwd: workspace,
        createDefaultGoal: true
      });
      const database = openRunsteadDatabase(initialized.stateDb);

      try {
        const task = listTasks({ cwd: workspace }).tasks[0];

        if (task === undefined) {
          throw new Error("Expected generated task");
        }

        const goal = showGoal({ cwd: workspace, id: task.goalId }).goal;
        const transport = scriptedTransport([
          {
            outputText: "",
            toolCalls: [
              {
                id: "call_file_info",
                name: "file_info",
                arguments: JSON.stringify({
                  path: "src/index.ts"
                })
              },
              {
                id: "call_tree",
                name: "tree",
                arguments: JSON.stringify({
                  path: ".",
                  maxDepth: 2,
                  maxEntries: 10
                })
              }
            ],
            finishReason: "tool_calls",
            outputItems: []
          },
          {
            outputText: "Inspected files.",
            toolCalls: [],
            finishReason: "stop",
            outputItems: []
          }
        ]);
        const result = await runCodexDirectWorker({
          cwd: workspace,
          stateDb: initialized.stateDb,
          database,
          policy: allowDirectToolsPolicy,
          goal,
          task,
          model: "fake-codex",
          evidenceDir: join(initialized.root, "evidence"),
          transport
        });
        const toolCalls = database
          .prepare("SELECT action_type, status FROM tool_calls ORDER BY started_at, id")
          .all() as { action_type: string; status: string }[];
        const toolOutput = JSON.stringify(transport.requests[1]?.input);

        expect(result).toMatchObject({
          status: "completed",
          toolCalls: 2,
          summary: "Inspected files."
        });
        expect(toolCalls).toEqual(
          expect.arrayContaining([
            {
              action_type: "filesystem.stat",
              status: "completed"
            },
            {
              action_type: "filesystem.list",
              status: "completed"
            }
          ])
        );
        expect(toolOutput).toContain("src/index.ts");
        expect(toolOutput).toContain('\\"binary\\":false');
        expect(toolOutput).toContain("src/nested");
        expect(toolOutput).not.toContain("node_modules/pkg/ignored.ts");
      } finally {
        database.close();
      }
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("inspects package scripts and verifier candidates", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-codex-package-"));

    try {
      await writeFile(
        join(workspace, "package.json"),
        JSON.stringify(
          {
            packageManager: "pnpm@11.1.1",
            scripts: {
              build: "tsc -b",
              test: "vitest run"
            }
          },
          null,
          2
        )
      );
      await writeFile(
        join(workspace, "pnpm-workspace.yaml"),
        "packages:\n  - packages/*\n"
      );
      await writeFile(
        join(workspace, "turbo.json"),
        JSON.stringify({ tasks: { lint: {}, typecheck: {} } }, null, 2)
      );
      const initialized = await initRunstead({
        cwd: workspace,
        createDefaultGoal: true
      });
      const database = openRunsteadDatabase(initialized.stateDb);

      try {
        const task = listTasks({ cwd: workspace }).tasks[0];

        if (task === undefined) {
          throw new Error("Expected generated task");
        }

        const goal = showGoal({ cwd: workspace, id: task.goalId }).goal;
        const transport = scriptedTransport([
          {
            outputText: "",
            toolCalls: [
              {
                id: "call_package_scripts",
                name: "package_scripts",
                arguments: "{}"
              }
            ],
            finishReason: "tool_calls",
            outputItems: []
          },
          {
            outputText: "Inspected package scripts.",
            toolCalls: [],
            finishReason: "stop",
            outputItems: []
          }
        ]);
        const result = await runCodexDirectWorker({
          cwd: workspace,
          stateDb: initialized.stateDb,
          database,
          policy: allowDirectToolsPolicy,
          goal,
          task,
          model: "fake-codex",
          evidenceDir: join(initialized.root, "evidence"),
          transport
        });
        const metadataCall = database
          .prepare("SELECT status FROM tool_calls WHERE action_type = ?")
          .get("repo.metadata.read") as { status: string };
        const toolOutput = JSON.stringify(transport.requests[1]?.input);

        expect(result).toMatchObject({
          status: "completed",
          toolCalls: 1,
          summary: "Inspected package scripts."
        });
        expect(metadataCall.status).toBe("completed");
        expect(toolOutput).toContain('\\"packageManager\\":\\"pnpm\\"');
        expect(toolOutput).toContain('\\"name\\":\\"test\\"');
        expect(toolOutput).toContain('\\"command\\":\\"pnpm test\\"');
        expect(toolOutput).toContain('\\"command\\":\\"pnpm exec turbo run lint\\"');
        expect(toolOutput).toContain("packages/*");
      } finally {
        database.close();
      }
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("applies structured patches through governed filesystem patch actions", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-codex-apply-patch-"));

    try {
      await mkdir(join(workspace, "src"), { recursive: true });
      await writeFile(join(workspace, "src", "message.txt"), "before\n");
      const initialized = await initRunstead({
        cwd: workspace,
        createDefaultGoal: true
      });
      const database = openRunsteadDatabase(initialized.stateDb);

      try {
        const task = listTasks({ cwd: workspace }).tasks[0];

        if (task === undefined) {
          throw new Error("Expected generated task");
        }

        const goal = showGoal({ cwd: workspace, id: task.goalId }).goal;
        const transport = scriptedTransport([
          {
            outputText: "",
            toolCalls: [
              {
                id: "call_apply_patch",
                name: "apply_patch",
                arguments: JSON.stringify({
                  replacements: [
                    {
                      path: "src/message.txt",
                      search: "before",
                      replace: "after"
                    }
                  ]
                })
              }
            ],
            finishReason: "tool_calls",
            outputItems: []
          },
          {
            outputText: "Applied patch.",
            toolCalls: [],
            finishReason: "stop",
            outputItems: []
          }
        ]);
        const result = await runCodexDirectWorker({
          cwd: workspace,
          stateDb: initialized.stateDb,
          database,
          policy: allowDirectToolsPolicy,
          goal,
          task,
          model: "fake-codex",
          evidenceDir: join(initialized.root, "evidence"),
          transport
        });
        const patchCall = database
          .prepare("SELECT status, output_json FROM tool_calls WHERE action_type = ?")
          .get("filesystem.patch") as { status: string; output_json: string };
        const policyDecision = database
          .prepare(
            `
            SELECT pd.action_json
            FROM policy_decisions pd
            JOIN tool_calls tc ON tc.policy_decision_id = pd.id
            WHERE tc.action_type = ?
          `
          )
          .get("filesystem.patch") as {
          action_json: string;
        };
        const action = JSON.parse(policyDecision.action_json) as {
          context: {
            filesTouched: string[];
            diffHash: string;
            dependencyImpact: {
              kind: string;
              files: string[];
            };
            riskSummary: string;
            canonicalSignature: string;
          };
        };

        expect(result).toMatchObject({
          status: "completed",
          toolCalls: 1,
          summary: "Applied patch."
        });
        await expect(
          readFile(join(workspace, "src", "message.txt"), "utf8")
        ).resolves.toBe("after\n");
        expect(patchCall.status).toBe("completed");
        expect(patchCall.output_json).toContain("src/message.txt");
        expect(action.context).toMatchObject({
          filesTouched: ["src/message.txt"],
          dependencyImpact: {
            kind: "none",
            files: []
          }
        });
        expect(action.context.diffHash).toMatch(/^[a-f0-9]{64}$/);
        expect(action.context.canonicalSignature).toMatch(/^[a-f0-9]{64}$/);
        expect(action.context.riskSummary).toContain(
          "no dependency file impact"
        );
      } finally {
        database.close();
      }
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("applies unified diffs through governed filesystem patch actions", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-codex-unified-patch-"));

    try {
      await execFileAsync("git", ["init"], { cwd: workspace });
      await mkdir(join(workspace, "src"), { recursive: true });
      await writeFile(join(workspace, "src", "message.txt"), "before\n");
      const initialized = await initRunstead({
        cwd: workspace,
        createDefaultGoal: true
      });
      const database = openRunsteadDatabase(initialized.stateDb);

      try {
        const task = listTasks({ cwd: workspace }).tasks[0];

        if (task === undefined) {
          throw new Error("Expected generated task");
        }

        const goal = showGoal({ cwd: workspace, id: task.goalId }).goal;
        const transport = scriptedTransport([
          {
            outputText: "",
            toolCalls: [
              {
                id: "call_unified_patch",
                name: "apply_patch",
                arguments: JSON.stringify({
                  patch: [
                    "diff --git a/src/message.txt b/src/message.txt",
                    "--- a/src/message.txt",
                    "+++ b/src/message.txt",
                    "@@ -1 +1 @@",
                    "-before",
                    "+after",
                    ""
                  ].join("\n")
                })
              }
            ],
            finishReason: "tool_calls",
            outputItems: []
          },
          {
            outputText: "Applied unified patch.",
            toolCalls: [],
            finishReason: "stop",
            outputItems: []
          }
        ]);
        const result = await runCodexDirectWorker({
          cwd: workspace,
          stateDb: initialized.stateDb,
          database,
          policy: allowDirectToolsPolicy,
          goal,
          task,
          model: "fake-codex",
          evidenceDir: join(initialized.root, "evidence"),
          transport
        });

        expect(result).toMatchObject({
          status: "completed",
          toolCalls: 1,
          summary: "Applied unified patch."
        });
        await expect(
          readFile(join(workspace, "src", "message.txt"), "utf8")
        ).resolves.toBe("after\n");
      } finally {
        database.close();
      }
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("runs auto-discovered verifiers with evidence", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-codex-run-verifier-"));

    try {
      await writeFile(
        join(workspace, "package.json"),
        JSON.stringify({
          scripts: {
            test: "node -e \"console.log('verifier ok')\""
          }
        })
      );
      const initialized = await initRunstead({
        cwd: workspace,
        createDefaultGoal: true
      });
      const database = openRunsteadDatabase(initialized.stateDb);

      try {
        const task = listTasks({ cwd: workspace }).tasks[0];

        if (task === undefined) {
          throw new Error("Expected generated task");
        }

        const goal = showGoal({ cwd: workspace, id: task.goalId }).goal;
        const transport = scriptedTransport([
          {
            outputText: "",
            toolCalls: [
              {
                id: "call_run_verifier",
                name: "run_verifier",
                arguments: JSON.stringify({
                  name: "test"
                })
              }
            ],
            finishReason: "tool_calls",
            outputItems: []
          },
          {
            outputText: "Ran verifier.",
            toolCalls: [],
            finishReason: "stop",
            outputItems: []
          }
        ]);
        const result = await runCodexDirectWorker({
          cwd: workspace,
          stateDb: initialized.stateDb,
          database,
          policy: allowDirectToolsPolicy,
          goal,
          task,
          model: "fake-codex",
          evidenceDir: join(initialized.root, "evidence"),
          transport
        });
        const verifierCall = database
          .prepare("SELECT status, output_json FROM tool_calls WHERE action_type = ?")
          .get("verifier.run") as { status: string; output_json: string };
        const evidenceRows = database
          .prepare("SELECT id, type FROM evidence WHERE type = 'command_output'")
          .all() as { id: string; type: string }[];
        const toolOutput = JSON.stringify(transport.requests[1]?.input);

        expect(result).toMatchObject({
          status: "completed",
          toolCalls: 1,
          summary: "Ran verifier."
        });
        expect(verifierCall.status).toBe("completed");
        expect(verifierCall.output_json).toContain("evidenceId");
        expect(evidenceRows).toHaveLength(1);
        expect(evidenceRows[0]?.id).toMatch(/^ev_/);
        expect(evidenceRows[0]?.type).toBe("command_output");
        expect(toolOutput).toContain("verifier ok");
        expect(toolOutput).toContain('\\"exitCode\\":0');
      } finally {
        database.close();
      }
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("reads stored evidence artifacts by id", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-codex-read-evidence-"));

    try {
      const initialized = await initRunstead({
        cwd: workspace,
        createDefaultGoal: true
      });
      const database = openRunsteadDatabase(initialized.stateDb);

      try {
        const task = listTasks({ cwd: workspace }).tasks[0];

        if (task === undefined) {
          throw new Error("Expected generated task");
        }

        const evidence = await storeCommandVerifierEvidence({
          cwd: workspace,
          runsteadRoot: initialized.root,
          database,
          task,
          command: {
            name: "fixture",
            command: "node -e \"console.log('artifact ok')\""
          }
        });
        const goal = showGoal({ cwd: workspace, id: task.goalId }).goal;
        const transport = scriptedTransport([
          {
            outputText: "",
            toolCalls: [
              {
                id: "call_read_evidence",
                name: "read_evidence",
                arguments: JSON.stringify({
                  id: evidence.evidence.id,
                  maxBytes: 20_000
                })
              }
            ],
            finishReason: "tool_calls",
            outputItems: []
          },
          {
            outputText: "Read evidence.",
            toolCalls: [],
            finishReason: "stop",
            outputItems: []
          }
        ]);
        const result = await runCodexDirectWorker({
          cwd: workspace,
          stateDb: initialized.stateDb,
          database,
          policy: allowDirectToolsPolicy,
          goal,
          task,
          model: "fake-codex",
          evidenceDir: join(initialized.root, "evidence"),
          transport
        });
        const evidenceCall = database
          .prepare("SELECT status, output_json FROM tool_calls WHERE action_type = ?")
          .get("evidence.read") as { status: string; output_json: string };
        const toolOutput = JSON.stringify(transport.requests[1]?.input);

        expect(result).toMatchObject({
          status: "completed",
          toolCalls: 1,
          summary: "Read evidence."
        });
        expect(evidenceCall.status).toBe("completed");
        expect(evidenceCall.output_json).toContain(evidence.evidence.id);
        expect(toolOutput).toContain("artifact ok");
        expect(toolOutput).toContain(evidence.evidence.id);
      } finally {
        database.close();
      }
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("returns cached workspace facts from repo inspection evidence", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-codex-workspace-facts-"));

    try {
      await writeFile(
        join(workspace, "package.json"),
        JSON.stringify({
          scripts: {
            test: "node --test"
          }
        })
      );
      const initialized = await initRunstead({
        cwd: workspace,
        createDefaultGoal: true
      });
      const database = openRunsteadDatabase(initialized.stateDb);

      try {
        const task = listTasks({ cwd: workspace }).tasks[0];

        if (task === undefined) {
          throw new Error("Expected generated task");
        }

        const goal = showGoal({ cwd: workspace, id: task.goalId }).goal;
        const transport = scriptedTransport([
          {
            outputText: "",
            toolCalls: [
              {
                id: "call_workspace_facts",
                name: "workspace_facts",
                arguments: "{}"
              }
            ],
            finishReason: "tool_calls",
            outputItems: []
          },
          {
            outputText: "Read workspace facts.",
            toolCalls: [],
            finishReason: "stop",
            outputItems: []
          }
        ]);
        const result = await runCodexDirectWorker({
          cwd: workspace,
          stateDb: initialized.stateDb,
          database,
          policy: allowDirectToolsPolicy,
          goal,
          task,
          model: "fake-codex",
          evidenceDir: join(initialized.root, "evidence"),
          transport
        });
        const factsCall = database
          .prepare("SELECT status, output_json FROM tool_calls WHERE action_type = ?")
          .get("workspace.facts.read") as { status: string; output_json: string };
        const toolOutput = JSON.stringify(transport.requests[1]?.input);

        expect(result).toMatchObject({
          status: "completed",
          toolCalls: 1,
          summary: "Read workspace facts."
        });
        expect(factsCall.status).toBe("completed");
        expect(factsCall.output_json).toContain('"cached":true');
        expect(toolOutput).toContain("repo_inspection");
        expect(toolOutput).toContain('\\"cached\\":true');
        expect(toolOutput).toContain("npm test");
      } finally {
        database.close();
      }
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("returns recoverable tool execution errors to the model", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-codex-tool-error-"));

    try {
      const initialized = await initRunstead({
        cwd: workspace,
        createDefaultGoal: true
      });
      const database = openRunsteadDatabase(initialized.stateDb);

      try {
        const task = listTasks({ cwd: workspace }).tasks[0];

        if (task === undefined) {
          throw new Error("Expected generated task");
        }

        const goal = showGoal({ cwd: workspace, id: task.goalId }).goal;
        const transport = scriptedTransport([
          {
            outputText: "",
            toolCalls: [
              {
                id: "call_missing_file",
                name: "read_file",
                arguments: JSON.stringify({
                  path: "pyproject.toml"
                })
              }
            ],
            finishReason: "tool_calls",
            outputItems: []
          },
          {
            outputText: "Missing file handled.",
            toolCalls: [],
            finishReason: "stop",
            outputItems: []
          }
        ]);
        const result = await runCodexDirectWorker({
          cwd: workspace,
          stateDb: initialized.stateDb,
          database,
          policy: allowDirectToolsPolicy,
          goal,
          task,
          model: "fake-codex",
          evidenceDir: join(initialized.root, "evidence"),
          transport
        });
        const toolCalls = database
          .prepare("SELECT action_type, status FROM tool_calls ORDER BY started_at, id")
          .all() as { action_type: string; status: string }[];

        expect(result).toMatchObject({
          status: "completed",
          exitCode: 0,
          toolCalls: 1,
          summary: "Missing file handled."
        });
        expect(toolCalls).toEqual(
          expect.arrayContaining([
            {
              action_type: "model.inference.request",
              status: "completed"
            },
            {
              action_type: "filesystem.read",
              status: "failed"
            }
          ])
        );
        expect(
          toolCalls.filter((call) => call.action_type === "model.inference.request")
        ).toHaveLength(2);
        expect(JSON.stringify(transport.requests[1]?.input)).toContain(
          "pyproject.toml"
        );
        expect(JSON.stringify(transport.requests[1]?.input)).toContain("ENOENT");
      } finally {
        database.close();
      }
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("enforces task-scoped staged git diff tool calls", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-codex-staged-diff-"));

    try {
      const initialized = await initRunstead({
        cwd: workspace,
        createDefaultGoal: true
      });
      const database = openRunsteadDatabase(initialized.stateDb);

      try {
        const task = listTasks({ cwd: workspace }).tasks[0];

        if (task === undefined) {
          throw new Error("Expected generated task");
        }

        const scopedTask = {
          ...task,
          input: {
            ...task.input,
            gitDiffStaged: true
          }
        };
        const goal = showGoal({ cwd: workspace, id: task.goalId }).goal;
        const result = await runCodexDirectWorker({
          cwd: workspace,
          stateDb: initialized.stateDb,
          database,
          policy: allowDirectToolsPolicy,
          goal,
          task: scopedTask,
          model: "fake-codex",
          evidenceDir: join(initialized.root, "evidence"),
          transport: scriptedTransport([
            {
              outputText: "",
              toolCalls: [
                {
                  id: "call_staged_diff",
                  name: "git_diff",
                  arguments: JSON.stringify({
                    staged: false,
                    path: "src/index.ts"
                  })
                }
              ],
              finishReason: "tool_calls",
              outputItems: []
            },
            {
              outputText: "Reviewed staged diff.",
              toolCalls: [],
              finishReason: "stop",
              outputItems: []
            }
          ])
        });
        const diffCall = database
          .prepare("SELECT output_json FROM tool_calls WHERE action_type = 'git.diff'")
          .get() as { output_json: string };

        expect(result.status).toBe("completed");
        expect(diffCall.output_json).toContain("git diff --staged -- 'src/index.ts'");
      } finally {
        database.close();
      }
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("returns git log and show output through governed git read tools", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-codex-git-history-"));

    try {
      await execFileAsync("git", ["init"], { cwd: workspace });
      await execFileAsync("git", ["config", "user.name", "Runstead"], {
        cwd: workspace
      });
      await execFileAsync("git", ["config", "user.email", "runstead@example.com"], {
        cwd: workspace
      });
      await writeFile(join(workspace, "README.md"), "# Fixture\n");
      await execFileAsync("git", ["add", "README.md"], { cwd: workspace });
      await execFileAsync("git", ["commit", "-m", "initial fixture"], {
        cwd: workspace
      });
      const initialized = await initRunstead({
        cwd: workspace,
        createDefaultGoal: true
      });
      const database = openRunsteadDatabase(initialized.stateDb);

      try {
        const task = listTasks({ cwd: workspace }).tasks[0];

        if (task === undefined) {
          throw new Error("Expected generated task");
        }

        const goal = showGoal({ cwd: workspace, id: task.goalId }).goal;
        const transport = scriptedTransport([
          {
            outputText: "",
            toolCalls: [
              {
                id: "call_git_log",
                name: "git_log",
                arguments: JSON.stringify({
                  maxCommits: 5
                })
              },
              {
                id: "call_git_show",
                name: "git_show",
                arguments: JSON.stringify({
                  ref: "HEAD",
                  path: "README.md",
                  maxBytes: 20_000
                })
              }
            ],
            finishReason: "tool_calls",
            outputItems: []
          },
          {
            outputText: "Read git history.",
            toolCalls: [],
            finishReason: "stop",
            outputItems: []
          }
        ]);
        const result = await runCodexDirectWorker({
          cwd: workspace,
          stateDb: initialized.stateDb,
          database,
          policy: allowDirectToolsPolicy,
          goal,
          task,
          model: "fake-codex",
          evidenceDir: join(initialized.root, "evidence"),
          transport
        });
        const toolCalls = database
          .prepare("SELECT action_type, status FROM tool_calls ORDER BY started_at, id")
          .all() as { action_type: string; status: string }[];
        const toolOutput = JSON.stringify(transport.requests[1]?.input);

        expect(result).toMatchObject({
          status: "completed",
          toolCalls: 2,
          summary: "Read git history."
        });
        expect(toolCalls).toEqual(
          expect.arrayContaining([
            {
              action_type: "git.log",
              status: "completed"
            },
            {
              action_type: "git.show",
              status: "completed"
            }
          ])
        );
        expect(toolOutput).toContain("initial fixture");
        expect(toolOutput).toContain("README.md");
      } finally {
        database.close();
      }
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  }, 60_000);

  it("rejects git revision arguments that look like options", async () => {
    const root = await mkdtemp(join(tmpdir(), "runstead-codex-git-options-"));
    const workspace = join(root, "workspace");
    const logOutput = join(root, "git-log-output");
    const showOutput = join(root, "git-show-output");
    const diffOutput = join(root, "git-diff-output");

    try {
      await mkdir(workspace);
      await execFileAsync("git", ["init"], { cwd: workspace });
      await execFileAsync("git", ["config", "user.name", "Runstead"], {
        cwd: workspace
      });
      await execFileAsync("git", ["config", "user.email", "runstead@example.com"], {
        cwd: workspace
      });
      await writeFile(join(workspace, "README.md"), "# Fixture\n");
      await execFileAsync("git", ["add", "README.md"], { cwd: workspace });
      await execFileAsync("git", ["commit", "-m", "initial fixture"], {
        cwd: workspace
      });
      const initialized = await initRunstead({
        cwd: workspace,
        createDefaultGoal: true
      });
      const database = openRunsteadDatabase(initialized.stateDb);

      try {
        const task = listTasks({ cwd: workspace }).tasks[0];

        if (task === undefined) {
          throw new Error("Expected generated task");
        }

        const goal = showGoal({ cwd: workspace, id: task.goalId }).goal;
        const transport = scriptedTransport([
          {
            outputText: "",
            toolCalls: [
              {
                id: "call_git_log_option",
                name: "git_log",
                arguments: JSON.stringify({
                  range: `--output=${logOutput}`
                })
              },
              {
                id: "call_git_show_option",
                name: "git_show",
                arguments: JSON.stringify({
                  ref: `--output=${showOutput}`
                })
              },
              {
                id: "call_git_diff_option",
                name: "git_diff",
                arguments: JSON.stringify({
                  base: `--output=${diffOutput}`
                })
              }
            ],
            finishReason: "tool_calls",
            outputItems: []
          },
          {
            outputText: "Rejected unsafe git revisions.",
            toolCalls: [],
            finishReason: "stop",
            outputItems: []
          }
        ]);
        const result = await runCodexDirectWorker({
          cwd: workspace,
          stateDb: initialized.stateDb,
          database,
          policy: allowDirectToolsPolicy,
          goal,
          task,
          model: "fake-codex",
          evidenceDir: join(initialized.root, "evidence"),
          transport
        });
        const toolOutput = JSON.stringify(transport.requests[1]?.input);

        expect(result).toMatchObject({
          status: "completed",
          summary: "Rejected unsafe git revisions."
        });
        expect(toolOutput).toContain("must not start with");
        await expect(access(logOutput)).rejects.toThrow();
        await expect(access(showOutput)).rejects.toThrow();
        await expect(access(`${diffOutput}...HEAD`)).rejects.toThrow();
      } finally {
        database.close();
      }
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  }, 10000);

  it("returns bounded git diff summaries", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-codex-diff-summary-"));

    try {
      await execFileAsync("git", ["init"], { cwd: workspace });
      await execFileAsync("git", ["config", "user.name", "Runstead"], {
        cwd: workspace
      });
      await execFileAsync("git", ["config", "user.email", "runstead@example.com"], {
        cwd: workspace
      });
      await writeFile(join(workspace, "README.md"), "# Fixture\n");
      await execFileAsync("git", ["add", "README.md"], { cwd: workspace });
      await execFileAsync("git", ["commit", "-m", "initial fixture"], {
        cwd: workspace
      });
      await writeFile(join(workspace, "README.md"), "# Fixture\n\nChanged\n");
      const initialized = await initRunstead({
        cwd: workspace,
        createDefaultGoal: true
      });
      const database = openRunsteadDatabase(initialized.stateDb);

      try {
        const task = listTasks({ cwd: workspace }).tasks[0];

        if (task === undefined) {
          throw new Error("Expected generated task");
        }

        const goal = showGoal({ cwd: workspace, id: task.goalId }).goal;
        const transport = scriptedTransport([
          {
            outputText: "",
            toolCalls: [
              {
                id: "call_diff_summary",
                name: "diff_summary",
                arguments: JSON.stringify({
                  maxFiles: 10
                })
              }
            ],
            finishReason: "tool_calls",
            outputItems: []
          },
          {
            outputText: "Summarized diff.",
            toolCalls: [],
            finishReason: "stop",
            outputItems: []
          }
        ]);
        const result = await runCodexDirectWorker({
          cwd: workspace,
          stateDb: initialized.stateDb,
          database,
          policy: allowDirectToolsPolicy,
          goal,
          task,
          model: "fake-codex",
          evidenceDir: join(initialized.root, "evidence"),
          transport
        });
        const summaryCall = database
          .prepare("SELECT status, output_json FROM tool_calls WHERE action_type = ?")
          .get("git.diff.summary") as { status: string; output_json: string };
        const toolOutput = JSON.stringify(transport.requests[1]?.input);

        expect(result).toMatchObject({
          status: "completed",
          toolCalls: 1,
          summary: "Summarized diff."
        });
        expect(summaryCall.status).toBe("completed");
        expect(summaryCall.output_json).toContain('"files":1');
        expect(toolOutput).toContain("README.md");
        expect(toolOutput).toContain('\\"additions\\":2');
      } finally {
        database.close();
      }
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  }, 10000);

  it("enforces task-scoped base git diff tool calls", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-codex-base-diff-"));

    try {
      const initialized = await initRunstead({
        cwd: workspace,
        createDefaultGoal: true
      });
      const database = openRunsteadDatabase(initialized.stateDb);

      try {
        const task = listTasks({ cwd: workspace }).tasks[0];

        if (task === undefined) {
          throw new Error("Expected generated task");
        }

        const scopedTask = {
          ...task,
          input: {
            ...task.input,
            gitDiffBase: "origin/main"
          }
        };
        const goal = showGoal({ cwd: workspace, id: task.goalId }).goal;
        const result = await runCodexDirectWorker({
          cwd: workspace,
          stateDb: initialized.stateDb,
          database,
          policy: allowDirectToolsPolicy,
          goal,
          task: scopedTask,
          model: "fake-codex",
          evidenceDir: join(initialized.root, "evidence"),
          transport: scriptedTransport([
            {
              outputText: "",
              toolCalls: [
                {
                  id: "call_base_diff",
                  name: "git_diff",
                  arguments: JSON.stringify({
                    base: "ignored/base",
                    path: "src/index.ts"
                  })
                }
              ],
              finishReason: "tool_calls",
              outputItems: []
            },
            {
              outputText: "Reviewed base diff.",
              toolCalls: [],
              finishReason: "stop",
              outputItems: []
            }
          ])
        });
        const diffCall = database
          .prepare("SELECT output_json FROM tool_calls WHERE action_type = 'git.diff'")
          .get() as { output_json: string };

        expect(result.status).toBe("completed");
        expect(diffCall.output_json).toContain(
          "git diff --end-of-options 'origin/main...HEAD' -- 'src/index.ts'"
        );
      } finally {
        database.close();
      }
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  }, 30000);

  it("fails edit-style runs when the tool budget is exhausted", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-codex-tool-budget-"));

    try {
      const initialized = await initRunstead({
        cwd: workspace,
        createDefaultGoal: true
      });
      const database = openRunsteadDatabase(initialized.stateDb);

      try {
        const task = listTasks({ cwd: workspace }).tasks[0];

        if (task === undefined) {
          throw new Error("Expected generated task");
        }

        const goal = showGoal({ cwd: workspace, id: task.goalId }).goal;
        const transport = scriptedTransport([
          {
            outputText: "",
            toolCalls: [
              {
                id: "call_status",
                name: "git_status",
                arguments: "{}"
              }
            ],
            finishReason: "tool_calls",
            outputItems: []
          },
          {
            outputText: "",
            toolCalls: [
              {
                id: "call_diff",
                name: "git_diff",
                arguments: "{}"
              }
            ],
            finishReason: "tool_calls",
            outputItems: []
          }
        ]);
        const result = await runCodexDirectWorker({
          cwd: workspace,
          stateDb: initialized.stateDb,
          database,
          policy: allowDirectToolsPolicy,
          goal,
          task,
          model: "fake-codex",
          evidenceDir: join(initialized.root, "evidence"),
          transport,
          maxToolCalls: 1
        });

        expect(result.status).toBe("failed");
        expect(result.exitCode).toBe(1);
        expect(result.toolCalls).toBe(1);
        expect(result.summary).toContain("tool budget exhausted after 1 tool calls");
        expect(result.budget).toMatchObject({
          reason: "tool_calls",
          maxToolCalls: 1,
          toolCalls: 1
        });
        expect(transport.requests).toHaveLength(2);
      } finally {
        database.close();
      }
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("asks for a no-tool final summary when budget finalization is enabled", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-codex-budget-finalize-"));

    try {
      const initialized = await initRunstead({
        cwd: workspace,
        createDefaultGoal: true
      });
      const database = openRunsteadDatabase(initialized.stateDb);

      try {
        const task = listTasks({ cwd: workspace }).tasks[0];

        if (task === undefined) {
          throw new Error("Expected generated task");
        }

        const goal = showGoal({ cwd: workspace, id: task.goalId }).goal;
        const transport = scriptedTransport([
          {
            outputText: "",
            toolCalls: [
              {
                id: "call_status",
                name: "git_status",
                arguments: "{}"
              }
            ],
            finishReason: "tool_calls",
            outputItems: []
          },
          {
            outputText: "",
            toolCalls: [
              {
                id: "call_diff",
                name: "git_diff",
                arguments: "{}"
              }
            ],
            finishReason: "tool_calls",
            outputItems: []
          },
          {
            outputText: "Summary from gathered evidence.",
            toolCalls: [],
            finishReason: "stop",
            outputItems: []
          }
        ]);
        const result = await runCodexDirectWorker({
          cwd: workspace,
          stateDb: initialized.stateDb,
          database,
          policy: allowDirectToolsPolicy,
          goal,
          task,
          model: "fake-codex",
          evidenceDir: join(initialized.root, "evidence"),
          transport,
          maxToolCalls: 1,
          finalizeOnBudget: true
        });

        expect(result.status).toBe("completed");
        expect(result.exitCode).toBe(0);
        expect(result.summary).toBe("Summary from gathered evidence.");
        expect(result.warnings[0]).toContain(
          "tool budget exhausted after 1 tool calls"
        );
        expect(result.budget?.reason).toBe("tool_calls");
        expect(transport.requests).toHaveLength(3);
        expect(transport.requests[2]?.tools).toBeUndefined();
      } finally {
        database.close();
      }
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("stops after too many recoverable tool failures", async () => {
    const workspace = await mkdtemp(
      join(tmpdir(), "runstead-codex-failed-tool-budget-")
    );

    try {
      const initialized = await initRunstead({
        cwd: workspace,
        createDefaultGoal: true
      });
      const database = openRunsteadDatabase(initialized.stateDb);

      try {
        const task = listTasks({ cwd: workspace }).tasks[0];

        if (task === undefined) {
          throw new Error("Expected generated task");
        }

        const goal = showGoal({ cwd: workspace, id: task.goalId }).goal;
        const transport = scriptedTransport([
          {
            outputText: "",
            toolCalls: [
              {
                id: "call_missing_file",
                name: "read_file",
                arguments: JSON.stringify({
                  path: "missing.txt"
                })
              }
            ],
            finishReason: "tool_calls",
            outputItems: []
          }
        ]);
        const result = await runCodexDirectWorker({
          cwd: workspace,
          stateDb: initialized.stateDb,
          database,
          policy: allowDirectToolsPolicy,
          goal,
          task,
          model: "fake-codex",
          evidenceDir: join(initialized.root, "evidence"),
          transport,
          maxFailedToolCalls: 1
        });

        expect(result.status).toBe("failed");
        expect(result.toolCalls).toBe(1);
        expect(result.failedToolCalls).toBe(1);
        expect(result.summary).toContain(
          "failed-tool budget exhausted after 1 failed tool calls"
        );
        expect(result.budget).toMatchObject({
          reason: "failed_tool_calls",
          maxFailedToolCalls: 1
        });
        expect(transport.requests).toHaveLength(1);
      } finally {
        database.close();
      }
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("stops when a tool call requires approval", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-codex-approval-"));

    try {
      const initialized = await initRunstead({
        cwd: workspace,
        createDefaultGoal: true
      });
      const database = openRunsteadDatabase(initialized.stateDb);

      try {
        const task = listTasks({ cwd: workspace }).tasks[0];

        if (task === undefined) {
          throw new Error("Expected generated task");
        }

        const goal = showGoal({ cwd: workspace, id: task.goalId }).goal;
        const result = await runCodexDirectWorker({
          cwd: workspace,
          stateDb: initialized.stateDb,
          database,
          policy: modelAllowedRepoMaintenancePolicy,
          goal,
          task,
          model: "fake-codex",
          evidenceDir: join(initialized.root, "evidence"),
          transport: scriptedTransport([
            {
              outputText: "",
              toolCalls: [
                {
                  id: "call_approval",
                  name: "write_file",
                  arguments: JSON.stringify({
                    path: "src/fix.txt",
                    content: "fixed\n"
                  })
                }
              ],
              finishReason: "tool_calls",
              outputItems: []
            }
          ])
        });
        const storedWorkerRun = database
          .prepare("SELECT status, output_json FROM worker_runs WHERE id = ?")
          .get(result.workerRun.id) as { status: string; output_json: string };

        expect(result.status).toBe("waiting_approval");
        expect(result.approval?.id).toMatch(/^appr_/);
        expect(storedWorkerRun.status).toBe("waiting_approval");
        expect(storedWorkerRun.output_json).toContain("filesystem.write");
      } finally {
        database.close();
      }
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("blocks denied protected-path writes", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-codex-deny-"));

    try {
      const initialized = await initRunstead({
        cwd: workspace,
        createDefaultGoal: true
      });
      const database = openRunsteadDatabase(initialized.stateDb);

      try {
        const task = listTasks({ cwd: workspace }).tasks[0];

        if (task === undefined) {
          throw new Error("Expected generated task");
        }

        const goal = showGoal({ cwd: workspace, id: task.goalId }).goal;
        const result = await runCodexDirectWorker({
          cwd: workspace,
          stateDb: initialized.stateDb,
          database,
          policy: modelAllowedRepoMaintenancePolicy,
          goal,
          task,
          model: "fake-codex",
          evidenceDir: join(initialized.root, "evidence"),
          transport: scriptedTransport([
            {
              outputText: "",
              toolCalls: [
                {
                  id: "call_denied",
                  name: "write_file",
                  arguments: JSON.stringify({
                    path: ".env",
                    content: "TOKEN=secret\n"
                  })
                }
              ],
              finishReason: "tool_calls",
              outputItems: []
            }
          ])
        });
        const deniedToolCall = database
          .prepare(
            "SELECT status FROM tool_calls WHERE action_type = 'filesystem.write'"
          )
          .get() as { status: string };

        expect(result.status).toBe("blocked");
        expect(result.exitCode).toBe(3);
        expect(deniedToolCall.status).toBe("denied");
      } finally {
        database.close();
      }
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("defines the expected narrow native tool surface", () => {
    expect(codexDirectToolDefinitions().map((tool) => tool.name)).toEqual([
      "list_files",
      "search_text",
      "read_file",
      "read_many_files",
      "file_info",
      "tree",
      "package_scripts",
      "apply_patch",
      "run_verifier",
      "write_file",
      "run_command",
      "git_status",
      "git_diff",
      "git_log",
      "git_show",
      "diff_summary",
      "read_evidence",
      "workspace_facts"
    ]);
  });
});

const allowDirectToolsPolicy: PolicyProfile = {
  id: "allow_direct_tools_for_test",
  version: 1,
  defaultDecision: "deny",
  defaultRisk: "critical",
  rules: [
    {
      id: "allow_direct_tool_actions",
      when: {
        actionType: [
          "filesystem.read",
          "filesystem.list",
          "filesystem.search",
          "filesystem.stat",
          "filesystem.write",
          "filesystem.patch",
          "repo.metadata.read",
          "verifier.run",
          "shell.exec",
          "git.status",
          "git.diff",
          "git.log",
          "git.show",
          "git.diff.summary",
          "evidence.read",
          "workspace.facts.read",
          "model.inference.request"
        ]
      },
      decision: "allow",
      risk: "low"
    }
  ]
};

const modelAllowedRepoMaintenancePolicy: PolicyProfile = {
  id: "model_allowed_repo_maintenance_for_test",
  version: 1,
  defaultDecision: "require_approval",
  defaultRisk: "medium",
  rules: [
    {
      id: "deny_secret_files",
      when: {
        path: {
          matchesAny: [".env", ".env.*", "**/secrets/**", "infra/prod/**"]
        }
      },
      decision: "deny",
      risk: "critical"
    },
    {
      id: "allow_model_inference",
      when: {
        actionType: "model.inference.request"
      },
      decision: "allow",
      risk: "medium"
    }
  ]
};

function scriptedTransport(
  responses: Awaited<ReturnType<CodexDirectTransport["createResponse"]>>[]
): CodexDirectTransport & { requests: CodexResponsesRequest[] } {
  const requests: CodexResponsesRequest[] = [];

  return {
    requests,
    createResponse(request) {
      requests.push(request);
      const response = responses.shift();

      if (response === undefined) {
        throw new Error("No scripted Codex response left");
      }

      return Promise.resolve(response);
    }
  };
}
