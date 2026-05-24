import { spawn } from "node:child_process";
import { join, resolve } from "node:path";

import { createRunsteadId, type JsonObject, type Task } from "@runstead/core";
import { appendEventAndProject, openRunsteadDatabase } from "@runstead/state-sqlite";
import type { ReadinessEvidenceRequirement, ReadinessTarget } from "@runstead/runtime";
import type { RunsteadEvidenceCollector } from "@runstead/sdk";

import { createLocalAgentTask, type LocalAgentWorkerKind } from "./local-agent.js";
import { loadPolicyProfileFromFile } from "./policy-loader.js";
import { type ActionEnvelope } from "./policy.js";
import { requireRunsteadStateDb } from "./runstead-root.js";
import {
  addStartupEvidence,
  type StartupEvidenceSourceInput,
  type StartupGateStage
} from "./startup-evidence.js";
import {
  loadStartupReadinessExtensions,
  startupReadinessExtensionEvidenceRequirements,
  startupReadinessExtensionPolicyBlockers,
  type LoadedStartupReadinessExtension
} from "./startup-extension-loader.js";
import type { ResolvedStartupWorkerGovernanceProfile } from "./startup-founder-flow.js";
import { runGovernedToolAction } from "./governed-action.js";
import { finishWorkerRun, startWorkerRun } from "./runtime-audit.js";

const EXTENSION_COLLECTOR_TIMEOUT_MS = 30_000;

export interface StartupExtensionExecutionResult {
  status: "passed" | "blocked";
  loaded: string[];
  artifacts: string[];
  evidenceIds: string[];
  blockers: string[];
  warnings: string[];
  collectorResults: StartupExtensionCollectorExecutionResult[];
}

export interface StartupExtensionCollectorExecutionResult {
  extensionId: string;
  collectorId: string;
  status: "passed" | "blocked" | "skipped";
  command?: string;
  evidenceIds: string[];
  blockers: string[];
  warnings: string[];
}

interface StartupExtensionCollectorExecutionInput {
  cwd: string;
  target: ReadinessTarget;
  stage: StartupGateStage;
  worker: LocalAgentWorkerKind;
  governanceProfile: ResolvedStartupWorkerGovernanceProfile;
  now?: Date;
}

export async function executeStartupReadinessExtensions(
  input: StartupExtensionCollectorExecutionInput
): Promise<StartupExtensionExecutionResult> {
  const cwd = resolve(input.cwd);
  const loaded = await loadStartupReadinessExtensions({ cwd });
  const requirements = startupReadinessExtensionEvidenceRequirements(
    loaded.extensions,
    { stage: input.stage }
  );
  const policyBlockers = startupReadinessExtensionPolicyBlockers({
    extensions: loaded.extensions,
    requirements,
    target: input.target,
    worker: input.worker,
    governanceProfile: input.governanceProfile
  });
  const collectorInputs = startupExtensionCollectorsForTarget({
    extensions: loaded.extensions,
    requirements,
    target: input.target
  });

  if (loaded.issues.length > 0 || policyBlockers.length > 0) {
    return {
      status: "blocked",
      loaded: loaded.extensions.map((extension) => extension.contract.extensionId),
      artifacts: loaded.discoveredPaths,
      evidenceIds: [],
      blockers: [...loaded.issues, ...policyBlockers],
      warnings: [],
      collectorResults: []
    };
  }

  if (collectorInputs.length === 0) {
    return {
      status: "passed",
      loaded: loaded.extensions.map((extension) => extension.contract.extensionId),
      artifacts: loaded.discoveredPaths,
      evidenceIds: [],
      blockers: [],
      warnings:
        loaded.extensions.length === 0
          ? []
          : ["no executable extension collectors were required for this target"],
      collectorResults: []
    };
  }

  const task = await createExtensionCollectorTask({
    cwd,
    worker: input.worker,
    ...(input.now === undefined ? {} : { now: input.now })
  });
  const state = await requireRunsteadStateDb(cwd);
  const database = openRunsteadDatabase(state.stateDb);
  const collectorResults: StartupExtensionCollectorExecutionResult[] = [];

  try {
    const runningTask = startExtensionCollectorTask(database, task, input.now);
    const workerRun = startWorkerRun({
      database,
      task: runningTask,
      workerType: "extension_collector",
      enforcementLevel: "policy_enforced",
      ...(input.now === undefined ? {} : { now: input.now })
    });
    const policy = await loadPolicyProfileFromFile(
      join(state.root, "policies", "repo-maintenance.yaml")
    );

    for (const collectorInput of collectorInputs) {
      const { extension, collector } = collectorInput;
      const missingSecrets = collector.requiredSecrets.filter(
        (secret) => process.env[secret] === undefined || process.env[secret] === ""
      );

      if (missingSecrets.length > 0) {
        collectorResults.push({
          extensionId: extension.contract.extensionId,
          collectorId: collector.id,
          status: "blocked",
          ...(collector.command === undefined ? {} : { command: collector.command }),
          evidenceIds: [],
          blockers: [
            `extension ${extension.contract.extensionId}/${collector.id} requires secrets: ${missingSecrets.join(", ")}`
          ],
          warnings: []
        });
        continue;
      }

      if (collector.command === undefined) {
        collectorResults.push({
          extensionId: extension.contract.extensionId,
          collectorId: collector.id,
          status: "skipped",
          evidenceIds: [],
          blockers: [],
          warnings: [
            `extension ${extension.contract.extensionId}/${collector.id} has no command execution contract`
          ]
        });
        continue;
      }

      try {
        const governed = await runGovernedToolAction({
          cwd,
          stateDb: state.stateDb,
          database,
          policy,
          task: runningTask,
          workerRun,
          action: extensionCollectorAction({
            task: runningTask,
            extensionId: extension.contract.extensionId,
            collector,
            cwd
          }),
          requestedBy: "runstead:extension-collector",
          ...(input.now === undefined ? {} : { now: input.now }),
          run: async () => {
            const command = await runExtensionCollectorCommand({
              cwd,
              command: collector.command ?? "",
              timeoutMs: EXTENSION_COLLECTOR_TIMEOUT_MS
            });
            const evidenceIds = await recordExtensionCollectorEvidence({
              cwd,
              target: input.target,
              stage: input.stage,
              extension,
              collector,
              stdout: command.stdout,
              ...(input.now === undefined ? {} : { now: input.now })
            });

            return {
              value: {
                command,
                evidenceIds
              },
              output: {
                exitCode: command.exitCode,
                evidenceIds
              }
            };
          }
        });

        collectorResults.push({
          extensionId: extension.contract.extensionId,
          collectorId: collector.id,
          status: governed.value.command.exitCode === 0 ? "passed" : "blocked",
          command: collector.command,
          evidenceIds: governed.value.evidenceIds,
          blockers:
            governed.value.command.exitCode === 0
              ? []
              : [
                  `extension ${extension.contract.extensionId}/${collector.id} collector exited ${governed.value.command.exitCode}`
                ],
          warnings:
            governed.value.command.stderr.trim().length === 0
              ? []
              : [governed.value.command.stderr.trim()]
        });
      } catch (error) {
        collectorResults.push({
          extensionId: extension.contract.extensionId,
          collectorId: collector.id,
          status: "blocked",
          command: collector.command,
          evidenceIds: [],
          blockers: [
            `extension ${extension.contract.extensionId}/${collector.id} collector failed: ${errorMessage(error)}`
          ],
          warnings: []
        });
      }
    }

    const blocked = collectorResults.flatMap((result) => result.blockers);

    finishWorkerRun({
      database,
      workerRun,
      status: blocked.length === 0 ? "completed" : "failed",
      output: {
        collectors: collectorResults.length,
        evidenceIds: collectorResults.flatMap((result) => result.evidenceIds),
        blockers: blocked
      },
      ...(input.now === undefined ? {} : { now: input.now })
    });
    finishExtensionCollectorTask(database, runningTask, blocked, input.now);

    return {
      status: blocked.length === 0 ? "passed" : "blocked",
      loaded: loaded.extensions.map((extension) => extension.contract.extensionId),
      artifacts: loaded.discoveredPaths,
      evidenceIds: collectorResults.flatMap((result) => result.evidenceIds),
      blockers: blocked,
      warnings: collectorResults.flatMap((result) => result.warnings),
      collectorResults
    };
  } finally {
    database.close();
  }
}

function startupExtensionCollectorsForTarget(input: {
  extensions: LoadedStartupReadinessExtension[];
  requirements: ReadinessEvidenceRequirement[];
  target: ReadinessTarget;
}): {
  extension: LoadedStartupReadinessExtension;
  collector: RunsteadEvidenceCollector;
}[] {
  const requiredTypes = new Set(
    input.requirements
      .filter((requirement) => requirement.targets.includes(input.target))
      .flatMap((requirement) => requirement.evidenceTypes.map(normalizeEvidenceType))
  );

  return input.extensions.flatMap((extension) =>
    extension.contract.collectors
      .filter(
        (collector) =>
          collector.targets.includes(input.target) &&
          collector.producesEvidenceTypes
            .map(normalizeEvidenceType)
            .some((type) => requiredTypes.has(type))
      )
      .map((collector) => ({ extension, collector }))
  );
}

async function createExtensionCollectorTask(input: {
  cwd: string;
  worker: LocalAgentWorkerKind;
  now?: Date;
}): Promise<Task> {
  const created = await createLocalAgentTask({
    cwd: input.cwd,
    title: "Run startup extension collectors",
    prompt:
      "Collect extension-defined readiness evidence using governed local commands.",
    worker: input.worker,
    mode: "read-only",
    ...(input.now === undefined ? {} : { now: input.now })
  });

  return created.task;
}

function startExtensionCollectorTask(
  database: Parameters<typeof appendEventAndProject>[0],
  task: Task,
  now?: Date
): Task {
  const updatedAt = (now ?? new Date()).toISOString();
  const runningTask: Task = {
    ...task,
    status: "running",
    attempt: task.attempt + 1,
    updatedAt
  };

  appendEventAndProject(database, {
    event: {
      eventId: createRunsteadId("evt"),
      type: "task.started",
      aggregateType: "task",
      aggregateId: runningTask.id,
      payload: {
        taskId: runningTask.id,
        attempt: runningTask.attempt
      },
      createdAt: updatedAt
    },
    projection: {
      type: "task",
      value: runningTask
    }
  });

  return runningTask;
}

function finishExtensionCollectorTask(
  database: Parameters<typeof appendEventAndProject>[0],
  task: Task,
  blockers: string[],
  now?: Date
): void {
  const updatedAt = (now ?? new Date()).toISOString();
  const status = blockers.length === 0 ? "completed" : "failed";
  const completedTask: Task = {
    ...task,
    status,
    output: {
      summary:
        blockers.length === 0
          ? "Extension collectors completed"
          : "Extension collectors failed",
      blockers
    },
    updatedAt
  };

  appendEventAndProject(database, {
    event: {
      eventId: createRunsteadId("evt"),
      type: `task.${status}`,
      aggregateType: "task",
      aggregateId: completedTask.id,
      payload: {
        taskId: completedTask.id,
        status,
        blockers
      },
      createdAt: updatedAt
    },
    projection: {
      type: "task",
      value: completedTask
    }
  });
}

function extensionCollectorAction(input: {
  task: Task;
  extensionId: string;
  collector: RunsteadEvidenceCollector;
  cwd: string;
}): ActionEnvelope {
  return {
    actionId: `act_${input.task.id}_${input.extensionId}_${input.collector.id}`,
    actionType: "shell.exec",
    resource: {
      type: "shell",
      id: `extension:${input.extensionId}/${input.collector.id}`
    },
    context: {
      cwd: input.cwd,
      ...(input.collector.command === undefined
        ? {}
        : { command: input.collector.command }),
      riskClass: "extension_collector",
      secretsRequested: [...input.collector.requiredSecrets],
      sideEffects:
        input.collector.qualityTier === "external_observed"
          ? ["network_read_external"]
          : ["local_read"]
    }
  };
}

function runExtensionCollectorCommand(input: {
  cwd: string;
  command: string;
  timeoutMs: number;
}): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return new Promise((resolveCommand) => {
    const child = spawn(input.command, {
      cwd: input.cwd,
      shell: true,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const stdout: string[] = [];
    const stderr: string[] = [];
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
    }, input.timeoutMs);

    child.stdout.on("data", (chunk) => stdout.push(String(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(String(chunk)));
    child.once("close", (exitCode) => {
      clearTimeout(timeout);
      resolveCommand({
        stdout: stdout.join(""),
        stderr: stderr.join(""),
        exitCode
      });
    });
  });
}

async function recordExtensionCollectorEvidence(input: {
  cwd: string;
  target: ReadinessTarget;
  stage: StartupGateStage;
  extension: LoadedStartupReadinessExtension;
  collector: RunsteadEvidenceCollector;
  stdout: string;
  now?: Date;
}): Promise<string[]> {
  const items = parseCollectorEvidenceItems(input.stdout);
  const evidenceIds: string[] = [];

  for (const item of items) {
    const type = normalizeEvidenceType(
      stringValue(item.type) ?? stringValue(item.evidenceType) ?? ""
    );
    const produced = new Set(
      input.collector.producesEvidenceTypes.map(normalizeEvidenceType)
    );

    if (!produced.has(type)) {
      throw new Error(
        `collector produced ${type || "unknown"} but declares ${input.collector.producesEvidenceTypes.join(", ")}`
      );
    }

    const content = collectorEvidenceContent({
      item,
      target: input.target,
      extensionId: input.extension.contract.extensionId,
      collector: input.collector
    });
    const result = await addStartupEvidence({
      cwd: input.cwd,
      type,
      summary:
        stringValue(item.summary) ??
        `Extension ${input.extension.contract.extensionId}/${input.collector.id} evidence`,
      content: JSON.stringify(content),
      sourceRefs: [
        `extension:${input.extension.contract.extensionId}/${input.collector.id}`
      ],
      sources: collectorEvidenceSources({
        item,
        extensionId: input.extension.contract.extensionId,
        collector: input.collector,
        ...(input.now === undefined ? {} : { now: input.now })
      }),
      gate: input.stage,
      ...(input.now === undefined ? {} : { now: input.now })
    });

    evidenceIds.push(result.evidence.id);
  }

  if (evidenceIds.length === 0) {
    throw new Error("collector stdout did not contain evidence records");
  }

  return evidenceIds;
}

function parseCollectorEvidenceItems(stdout: string): Record<string, unknown>[] {
  const jsonText =
    stdout
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .reverse()
      .find((line) => line.startsWith("{") || line.startsWith("[")) ?? stdout.trim();
  const parsed = JSON.parse(jsonText) as unknown;
  const items =
    isRecord(parsed) && Array.isArray(parsed.evidence) ? parsed.evidence : [parsed];

  return items.filter(isRecord);
}

function collectorEvidenceContent(input: {
  item: Record<string, unknown>;
  target: ReadinessTarget;
  extensionId: string;
  collector: RunsteadEvidenceCollector;
}): JsonObject {
  const rawContent = input.item.content;
  const content = isRecord(rawContent) ? rawContent : input.item;

  return {
    ...content,
    runsteadExtension: {
      extensionId: input.extensionId,
      collectorId: input.collector.id,
      target: input.target,
      qualityTier: input.collector.qualityTier,
      evidenceTier:
        input.collector.qualityTier === "external_observed"
          ? "real_user_analytics"
          : "local_command"
    }
  };
}

function collectorEvidenceSources(input: {
  item: Record<string, unknown>;
  extensionId: string;
  collector: RunsteadEvidenceCollector;
  now?: Date;
}): StartupEvidenceSourceInput[] {
  const validSources: StartupEvidenceSourceInput[] = [];

  if (Array.isArray(input.item.sources)) {
    for (const source of input.item.sources.filter(isRecord)) {
      const uri = stringValue(source.uri);

      if (uri === undefined) {
        continue;
      }

      const kind = stringValue(source.kind);
      const capturedAt = stringValue(source.capturedAt);
      const trustLevel = stringValue(source.trustLevel);

      validSources.push({
        uri,
        ...(kind === undefined ? {} : { kind }),
        ...(capturedAt === undefined ? {} : { capturedAt }),
        ...(typeof source.freshnessDays === "number"
          ? { freshnessDays: source.freshnessDays }
          : {}),
        ...(trustLevel === undefined ? {} : { trustLevel })
      });
    }
  }

  return [
    ...validSources,
    {
      kind:
        input.collector.qualityTier === "external_observed"
          ? "analytics_real_user"
          : "local_command",
      uri: `extension:${input.extensionId}/${input.collector.id}`,
      capturedAt: (input.now ?? new Date()).toISOString(),
      ...(input.collector.defaultFreshnessDays === undefined
        ? {}
        : { freshnessDays: input.collector.defaultFreshnessDays }),
      trustLevel: trustLevelForCollector(input.collector.qualityTier),
      provenance: {
        command: input.collector.command ?? "",
        adapterId: input.collector.adapterId ?? ""
      }
    }
  ];
}

function trustLevelForCollector(qualityTier: string): string {
  if (qualityTier === "external_observed") {
    return "authoritative";
  }

  if (qualityTier === "machine_verified") {
    return "high";
  }

  if (qualityTier === "local_artifact") {
    return "medium";
  }

  return "low";
}

function normalizeEvidenceType(type: string): string {
  return type.startsWith("startup_") ? type.slice("startup_".length) : type;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
