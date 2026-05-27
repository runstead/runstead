import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { formatInstitutionalMemory } from "./startup-automation-format.js";
import {
  recordProjectFact,
  retrieveProjectFacts,
  type RetrieveProjectFactsResult
} from "./memory.js";
import { requireRunsteadStateDb } from "./runstead-root.js";
import { writeStartupStructuredArtifact } from "./startup-artifacts.js";
import { addStartupEvidence } from "./startup-evidence.js";
import type {
  CaptureInstitutionalMemoryOptions,
  CaptureInstitutionalMemoryResult,
  RetrieveStartupInstitutionalMemoryOptions
} from "./startup-automation-types.js";

export async function captureInstitutionalMemory(
  options: CaptureInstitutionalMemoryOptions = {}
): Promise<CaptureInstitutionalMemoryResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const state = await requireRunsteadStateDb(cwd);
  const generatedAt = (options.now ?? new Date()).toISOString();
  const knowledge =
    options.knowledge === undefined || options.knowledge.length === 0
      ? [
          "No institutional memory input recorded; capture founder-only context before scale."
        ]
      : options.knowledge;
  const scope = options.scope ?? "startup/institutional-memory";
  const markdown = formatInstitutionalMemory({
    generatedAt,
    scope,
    knowledge,
    sourceRefs: options.sourceRefs ?? []
  });

  await mkdir(join(state.root, "startup"), { recursive: true });

  const runtimePath = join(state.root, "startup", "institutional-memory.md");

  await writeFile(runtimePath, markdown, "utf8");
  const structuredFiles = [
    await writeStartupStructuredArtifact({
      kind: "startup_institutional_memory",
      generatedAt,
      markdownPath: runtimePath,
      data: {
        scope,
        knowledge,
        sourceRefs: options.sourceRefs ?? []
      }
    })
  ];

  const memory = recordProjectFact({
    cwd,
    scope,
    content: knowledge.join("\n"),
    sourceRefs: [
      pathToFileURL(runtimePath).href,
      ...structuredFiles.map((path) => pathToFileURL(path).href)
    ],
    createdBy: "startup scale memory capture",
    ...(options.now === undefined ? {} : { now: options.now })
  });
  const evidence = await addStartupEvidence({
    cwd,
    type: "institutional_memory",
    summary: `Institutional memory captured (${knowledge.length} item${knowledge.length === 1 ? "" : "s"})`,
    sourceRefs: [runtimePath, ...structuredFiles, ...(options.sourceRefs ?? [])],
    content: markdown,
    ...(options.now === undefined ? {} : { now: options.now })
  });

  return {
    root: state.root,
    stateDb: state.stateDb,
    files: [runtimePath],
    structuredFiles,
    evidenceId: evidence.evidence.id,
    memoryId: memory.memory.id,
    knowledge
  };
}

export function retrieveStartupInstitutionalMemory(
  options: RetrieveStartupInstitutionalMemoryOptions = {}
): RetrieveProjectFactsResult {
  return retrieveProjectFacts({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    scope: options.scope ?? "startup/institutional-memory",
    ...(options.query === undefined ? {} : { query: options.query }),
    ...(options.limit === undefined ? {} : { limit: options.limit }),
    ...(options.now === undefined ? {} : { now: options.now })
  });
}
