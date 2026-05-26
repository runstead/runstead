import type { RunsteadEvent } from "@runstead/core";
import type {
  DomainPackManifest,
  DomainPackRegistryEntry
} from "@runstead/domain-packs";

export interface InstallDomainPackOptions {
  cwd?: string;
  ref: string;
  roots?: string[];
  includeBuiltIns?: boolean;
  force?: boolean;
  now?: Date;
}

export interface InstallDomainPackResult {
  id: string;
  source: DomainPackRegistryEntry;
  destination: string;
  manifest: DomainPackManifest;
  manifestPath: string;
  installedFiles: string[];
  overwritten: boolean;
  event: RunsteadEvent;
}

export interface UninstallDomainPackOptions {
  cwd?: string;
  id: string;
  force?: boolean;
  now?: Date;
}

export interface UninstallDomainPackResult {
  id: string;
  destination: string;
  manifestPath: string;
  activeGoals: number;
  activeTasks: number;
  removed: boolean;
  manifest?: DomainPackManifest;
}

export interface UpgradeDomainPackOptions {
  cwd?: string;
  ref: string;
  roots?: string[];
  includeBuiltIns?: boolean;
  force?: boolean;
  now?: Date;
}

export interface UpgradeDomainPackResult {
  id: string;
  source: DomainPackRegistryEntry;
  destination: string;
  manifest: DomainPackManifest;
  manifestPath: string;
  installedFiles: string[];
  previousManifest?: DomainPackManifest;
  migrationSteps: string[];
  activeGoals: number;
  activeTasks: number;
  forced: boolean;
}
