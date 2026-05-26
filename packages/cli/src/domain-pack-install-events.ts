import { createRunsteadId, type RunsteadEvent } from "@runstead/core";
import type { DomainPackManifest } from "@runstead/domain-packs";

export function domainPackInstalledEvent(input: {
  id: string;
  destination: string;
  manifestPath: string;
  manifest: DomainPackManifest;
  overwritten: boolean;
  createdAt: string;
}): RunsteadEvent {
  return {
    eventId: createRunsteadId("evt"),
    type: "domain_pack.installed",
    aggregateType: "domain_pack",
    aggregateId: input.id,
    payload: {
      id: input.id,
      destination: input.destination,
      manifestPath: input.manifestPath,
      version: input.manifest.domain.version,
      files: input.manifest.files.length,
      overwritten: input.overwritten
    },
    createdAt: input.createdAt
  };
}

export function domainPackUninstalledEvent(input: {
  id: string;
  destination: string;
  manifestPath: string;
  manifest?: DomainPackManifest;
  activeGoals: number;
  activeTasks: number;
  forced: boolean;
  createdAt: string;
}): RunsteadEvent {
  return {
    eventId: createRunsteadId("evt"),
    type: "domain_pack.uninstalled",
    aggregateType: "domain_pack",
    aggregateId: input.id,
    payload: {
      id: input.id,
      destination: input.destination,
      manifestPath: input.manifestPath,
      version: input.manifest?.domain.version ?? null,
      files: input.manifest?.files.length ?? null,
      activeGoals: input.activeGoals,
      activeTasks: input.activeTasks,
      forced: input.forced
    },
    createdAt: input.createdAt
  };
}

export function domainPackUpgradedEvent(input: {
  id: string;
  destination: string;
  manifestPath: string;
  previousManifest?: DomainPackManifest;
  manifest: DomainPackManifest;
  migrationSteps: string[];
  activeGoals: number;
  activeTasks: number;
  forced: boolean;
  createdAt: string;
}): RunsteadEvent {
  return {
    eventId: createRunsteadId("evt"),
    type: "domain_pack.upgraded",
    aggregateType: "domain_pack",
    aggregateId: input.id,
    payload: {
      id: input.id,
      destination: input.destination,
      manifestPath: input.manifestPath,
      previousVersion: input.previousManifest?.domain.version ?? null,
      nextVersion: input.manifest.domain.version,
      previousFiles: input.previousManifest?.files.length ?? null,
      nextFiles: input.manifest.files.length,
      migrationSteps: input.migrationSteps,
      activeGoals: input.activeGoals,
      activeTasks: input.activeTasks,
      forced: input.forced
    },
    createdAt: input.createdAt
  };
}

export function domainPackMigrationSteps(input: {
  previousManifest?: DomainPackManifest;
  manifest: DomainPackManifest;
}): string[] {
  const previousVersion = input.previousManifest?.domain.version;
  const nextVersion = input.manifest.domain.version;

  return (input.manifest.migrations ?? [])
    .filter((migration) =>
      previousVersion === undefined
        ? migration.toVersion === nextVersion
        : migration.fromVersion === previousVersion &&
          migration.toVersion === nextVersion
    )
    .flatMap((migration) => migration.steps);
}
