import { join, resolve } from "node:path";

import {
  createRunsteadId,
  type Evidence,
  type JsonObject,
  type RunsteadEvent
} from "@runstead/core";
import { appendEventAndProject, type RunsteadDatabase } from "@runstead/state-sqlite";

import {
  inspectCiProvider,
  inspectBuildCommand,
  inspectGitRepository,
  inspectLintCommand,
  inspectPackageManager,
  inspectTypecheckCommand,
  inspectTestCommand,
  type CiProviderInspection,
  type GitInspection,
  type PackageManagerInspection,
  type PackageScriptCommandInspection
} from "./repo-inspection.js";
import { writeJsonArtifactFile } from "./artifact-store.js";

export interface RepoInspectionSnapshot {
  schemaVersion: 1;
  inspectedAt: string;
  cwd: string;
  git: GitInspection;
  packageManager: PackageManagerInspection;
  commands: {
    test: PackageScriptCommandInspection;
    lint: PackageScriptCommandInspection;
    typecheck: PackageScriptCommandInspection;
    build: PackageScriptCommandInspection;
  };
  ci: CiProviderInspection;
}

export interface StoreRepoInspectionEvidenceOptions {
  cwd?: string;
  runsteadRoot: string;
  database: RunsteadDatabase;
  now?: Date;
}

export interface StoreRepoInspectionEvidenceResult {
  evidence: Evidence;
  event: RunsteadEvent;
  snapshot: RepoInspectionSnapshot;
  artifactPath: string;
  artifactManifestPath: string;
}

export async function collectRepoInspection(
  cwd = process.cwd(),
  inspectedAt = new Date().toISOString()
): Promise<RepoInspectionSnapshot> {
  const workspace = resolve(cwd);
  const [
    git,
    packageManager,
    testCommand,
    lintCommand,
    typecheckCommand,
    buildCommand,
    ci
  ] = await Promise.all([
    inspectGitRepository(workspace),
    inspectPackageManager(workspace),
    inspectTestCommand(workspace),
    inspectLintCommand(workspace),
    inspectTypecheckCommand(workspace),
    inspectBuildCommand(workspace),
    inspectCiProvider(workspace)
  ]);

  return {
    schemaVersion: 1,
    inspectedAt,
    cwd: workspace,
    git,
    packageManager,
    commands: {
      test: testCommand,
      lint: lintCommand,
      typecheck: typecheckCommand,
      build: buildCommand
    },
    ci
  };
}

export async function storeRepoInspectionEvidence(
  options: StoreRepoInspectionEvidenceOptions
): Promise<StoreRepoInspectionEvidenceResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const runsteadRoot = resolve(options.runsteadRoot);
  const createdAt = (options.now ?? new Date()).toISOString();
  const snapshot = await collectRepoInspection(cwd, createdAt);
  const evidenceId = createRunsteadId("ev");
  const evidenceDir = join(runsteadRoot, "evidence");
  const artifactPath = join(evidenceDir, `repo-inspection-${evidenceId}.json`);
  const artifactWrite = await writeJsonArtifactFile({
    artifactPath,
    value: snapshot,
    createdAt,
    metadata: {
      evidenceId,
      evidenceType: "repo_inspection",
      subject: "repository"
    }
  });

  const evidence: Evidence = {
    id: evidenceId,
    type: "repo_inspection",
    subjectType: "repository",
    subjectId: snapshot.git.root ?? cwd,
    uri: artifactWrite.artifactUri,
    hash: artifactWrite.sha256,
    summary: summarizeInspection(snapshot),
    createdAt
  };
  const event: RunsteadEvent = {
    eventId: createRunsteadId("evt"),
    type: "evidence.recorded",
    aggregateType: "evidence",
    aggregateId: evidence.id,
    payload: evidenceEventPayload(evidence),
    createdAt
  };

  appendEventAndProject(options.database, {
    event,
    projection: {
      type: "evidence",
      value: evidence
    }
  });

  return {
    evidence,
    event,
    snapshot,
    artifactPath,
    artifactManifestPath: artifactWrite.manifestPath
  };
}

function evidenceEventPayload(evidence: Evidence): JsonObject {
  return {
    evidenceId: evidence.id,
    evidenceType: evidence.type,
    subjectType: evidence.subjectType,
    subjectId: evidence.subjectId,
    uri: evidence.uri,
    hash: evidence.hash,
    summary: evidence.summary
  };
}

function summarizeInspection(snapshot: RepoInspectionSnapshot): string {
  const packageManager = snapshot.packageManager.detected
    ? snapshot.packageManager.packageManager
    : "none";
  const testCommand = snapshot.commands.test.detected
    ? snapshot.commands.test.command
    : "none";
  const lintCommand = snapshot.commands.lint.detected
    ? snapshot.commands.lint.command
    : "none";
  const typecheckCommand = snapshot.commands.typecheck.detected
    ? snapshot.commands.typecheck.command
    : "none";
  const buildCommand = snapshot.commands.build.detected
    ? snapshot.commands.build.command
    : "none";
  const ciProviders =
    snapshot.ci.providers.length > 0
      ? snapshot.ci.providers.map((provider) => provider.provider).join("+")
      : "none";

  return [
    "repo inspection",
    `git:${snapshot.git.isGitRepo ? "detected" : "none"}`,
    `package_manager:${packageManager}`,
    `test:${testCommand}`,
    `lint:${lintCommand}`,
    `typecheck:${typecheckCommand}`,
    `build:${buildCommand}`,
    `ci:${ciProviders}`
  ].join(", ");
}
