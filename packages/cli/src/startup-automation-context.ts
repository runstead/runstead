import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { collectRepoInspection } from "./inspection-evidence.js";
import {
  contextForFile,
  formatStartupAgentContext,
  startupContextEvidenceSummary
} from "./startup-automation-format.js";
import { requireRunsteadStateDb } from "./runstead-root.js";
import {
  stableRepoInspectionData,
  stableStartupGeneratedAt,
  structuredArtifactFileName,
  writeStartupStructuredArtifact,
  writeTextFileIfChanged
} from "./startup-artifacts.js";
import { addStartupEvidence } from "./startup-evidence.js";
import { exists } from "./startup-workspace-hygiene.js";
import type {
  GenerateStartupContextOptions,
  GenerateStartupContextResult
} from "./startup-automation-types.js";

const STARTUP_CONTEXT_FILES = ["AGENTS.md", "CLAUDE.md", "CODEX.md"];

export async function generateStartupContext(
  options: GenerateStartupContextOptions = {}
): Promise<GenerateStartupContextResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const state = await requireRunsteadStateDb(cwd);
  const generatedAt = (options.now ?? new Date()).toISOString();
  const inspection = await collectRepoInspection(cwd, generatedAt);
  const files: string[] = [];
  const structuredFiles: string[] = [];
  const contentBlocks: string[] = [];
  let generatedCount = 0;
  let ingestedCount = 0;
  const contextData = {
    contextFiles: STARTUP_CONTEXT_FILES,
    inspection: stableRepoInspectionData(inspection),
    architecturePrinciples: options.architecturePrinciples ?? [],
    technicalConstraints: options.technicalConstraints ?? [],
    acceptedDebt: options.acceptedDebt ?? []
  };
  await mkdir(join(state.root, "startup"), { recursive: true });

  if (options.currentOnly === true) {
    const currentPath = join(state.root, "startup", "current-agent-context.md");
    const currentData = {
      ...contextData,
      contextFile: "current-agent-context.md",
      contextScope: "current"
    };
    const contextGeneratedAt = await stableStartupGeneratedAt({
      kind: "startup_agent_context",
      markdownPath: currentPath,
      data: currentData,
      fallback: generatedAt
    });
    const context = formatStartupAgentContext({
      generatedAt: contextGeneratedAt,
      inspection,
      ...(options.architecturePrinciples === undefined
        ? {}
        : { architecturePrinciples: options.architecturePrinciples }),
      ...(options.technicalConstraints === undefined
        ? {}
        : { technicalConstraints: options.technicalConstraints }),
      ...(options.acceptedDebt === undefined
        ? {}
        : { acceptedDebt: options.acceptedDebt })
    });

    await writeTextFileIfChanged(currentPath, context);
    structuredFiles.push(
      await writeStartupStructuredArtifact({
        kind: "startup_agent_context",
        generatedAt: contextGeneratedAt,
        markdownPath: currentPath,
        data: currentData
      })
    );

    const evidence = await addStartupEvidence({
      cwd,
      type: "agent_context",
      summary: "Refreshed current startup agent context",
      sourceRefs: [currentPath, ...structuredFiles],
      content: context,
      ...(options.now === undefined ? {} : { now: options.now })
    });

    return {
      root: state.root,
      stateDb: state.stateDb,
      files: [currentPath],
      structuredFiles,
      evidenceId: evidence.evidence.id
    };
  }

  const summaryPath = join(state.root, "startup", "agent-context.md");
  const summaryData = {
    ...contextData,
    contextFile: "agent-context.md",
    contextScope: "initial"
  };
  const contextGeneratedAt = await stableStartupGeneratedAt({
    kind: "startup_agent_context",
    markdownPath: summaryPath,
    data: summaryData,
    fallback: generatedAt
  });
  const context = formatStartupAgentContext({
    generatedAt: contextGeneratedAt,
    inspection,
    ...(options.architecturePrinciples === undefined
      ? {}
      : { architecturePrinciples: options.architecturePrinciples }),
    ...(options.technicalConstraints === undefined
      ? {}
      : { technicalConstraints: options.technicalConstraints }),
    ...(options.acceptedDebt === undefined
      ? {}
      : { acceptedDebt: options.acceptedDebt })
  });

  for (const filename of STARTUP_CONTEXT_FILES) {
    const path = join(cwd, filename);
    let fileContent: string;
    let ingested = false;

    if (options.force !== true && (await exists(path))) {
      fileContent = await readFile(path, "utf8");
      ingested = true;
      ingestedCount += 1;
    } else {
      fileContent = contextForFile(filename, context);
      await writeTextFileIfChanged(path, fileContent);
      generatedCount += 1;
    }

    files.push(path);
    contentBlocks.push(`## ${filename}\n\n${fileContent}`);
    structuredFiles.push(
      await writeStartupStructuredArtifact({
        kind: "startup_agent_context",
        generatedAt: contextGeneratedAt,
        markdownPath: path,
        ...(options.writeTrackedContext === true
          ? {}
          : {
              structuredPath: join(
                state.root,
                "startup",
                "tracked-context",
                structuredArtifactFileName(filename)
              )
            }),
        data: {
          ...contextData,
          contextFile: filename,
          contextScope: "initial",
          ingested
        }
      })
    );
  }

  await writeTextFileIfChanged(summaryPath, context);
  structuredFiles.push(
    await writeStartupStructuredArtifact({
      kind: "startup_agent_context",
      generatedAt: contextGeneratedAt,
      markdownPath: summaryPath,
      data: summaryData
    })
  );

  const evidence = await addStartupEvidence({
    cwd,
    type: "agent_context",
    summary: startupContextEvidenceSummary({ generatedCount, ingestedCount }),
    sourceRefs: [...files, summaryPath, ...structuredFiles],
    content: ingestedCount > 0 ? contentBlocks.join("\n\n") : context,
    ...(options.now === undefined ? {} : { now: options.now })
  });

  return {
    root: state.root,
    stateDb: state.stateDb,
    files,
    structuredFiles,
    evidenceId: evidence.evidence.id
  };
}
