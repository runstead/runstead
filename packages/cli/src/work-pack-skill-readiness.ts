import { join } from "node:path";

import type { WorkPackComponent } from "@runstead/domain-packs";
import {
  evaluateSkillReadiness,
  loadSkillPackageFromFile,
  type SkillReadinessStatus
} from "@runstead/skills";

import { resolveRunsteadRootSync } from "./runstead-root.js";
import {
  loadSkillActivationRegistry,
  type SkillActivationStatus
} from "./skill-activations.js";
import type { WorkPackConnectorReadiness } from "./work-pack-connector-readiness.js";

export type WorkPackSkillReadinessStatus =
  | SkillReadinessStatus
  | "missing"
  | "disabled";

export interface WorkPackSkillReadiness {
  skill: string;
  status: WorkPackSkillReadinessStatus;
  activationStatus?: SkillActivationStatus;
  skillRoot?: string;
  domain?: string;
  requiredEnv: string[];
  missingEnv: string[];
  requiredConnectors: string[];
  missingConnectors: string[];
  requiredTools: string[];
  missingTools: string[];
  requiredWorkers: string[];
  missingWorkers: string[];
  fallbackForConnectors: string[];
  suppressedByConnectors: string[];
  fallbackForTools: string[];
  suppressedByTools: string[];
  reason: string;
}

export interface WorkPackSkillReadinessReport {
  readiness: WorkPackSkillReadiness[];
  issues: string[];
}

export async function evaluateWorkPackSkillReadiness(input: {
  cwd: string;
  domain: string;
  components?: WorkPackComponent[];
  connectorReadiness?: WorkPackConnectorReadiness[];
  supportedWorkers?: string[];
  env?: Record<string, string | undefined>;
}): Promise<WorkPackSkillReadinessReport> {
  const root = resolveRunsteadRootSync(input.cwd).root;
  const registry = loadSkillActivationRegistry(root);
  const issues: string[] = [];
  const activated = await Promise.all(
    registry.activations
      .filter((activation) => activation.domain === input.domain)
      .map(async (activation): Promise<WorkPackSkillReadiness | undefined> => {
        if (activation.status === "disabled") {
          return {
            skill: activation.name,
            status: "disabled",
            activationStatus: activation.status,
            skillRoot: activation.skillRoot,
            domain: activation.domain,
            requiredEnv: [],
            missingEnv: [],
            requiredConnectors: [],
            missingConnectors: [],
            requiredTools: [],
            missingTools: [],
            requiredWorkers: [],
            missingWorkers: [],
            fallbackForConnectors: [],
            suppressedByConnectors: [],
            fallbackForTools: [],
            suppressedByTools: [],
            reason: activation.disabledReason ?? "skill activation is disabled"
          };
        }

        try {
          const skill = await loadSkillPackageFromFile(
            join(activation.skillRoot, "skill.yaml")
          );
          const verdict = evaluateSkillReadiness({
            skill,
            ...(input.env === undefined ? {} : { env: input.env }),
            availableConnectors: readyConnectors(input.connectorReadiness ?? []),
            availableWorkers: input.supportedWorkers ?? [],
            availableTools: skill.allowedTools
          });

          return {
            skill: skill.name,
            status: verdict.status,
            activationStatus: activation.status,
            skillRoot: activation.skillRoot,
            domain: skill.domain,
            requiredEnv: skill.readiness.requiredEnv.map((entry) => entry.name),
            missingEnv: verdict.missingEnv,
            requiredConnectors: [...skill.readiness.requiredConnectors],
            missingConnectors: verdict.missingConnectors,
            requiredTools: [...skill.readiness.requiredTools],
            missingTools: verdict.missingTools,
            requiredWorkers: [...skill.readiness.requiredWorkers],
            missingWorkers: verdict.missingWorkers,
            fallbackForConnectors: [...skill.readiness.fallbackForConnectors],
            suppressedByConnectors: verdict.suppressedByConnectors,
            fallbackForTools: [...skill.readiness.fallbackForTools],
            suppressedByTools: verdict.suppressedByTools,
            reason: verdict.reason
          };
        } catch (error) {
          issues.push(
            `skill ${activation.name} failed to load from ${activation.skillRoot}: ${errorMessage(error)}`
          );
          return undefined;
        }
      })
  );
  const activatedReadiness = activated.filter(
    (item): item is WorkPackSkillReadiness => item !== undefined
  );
  const activatedNames = new Set(activatedReadiness.map((skill) => skill.skill));
  const missingDeclaredSkills = (input.components ?? [])
    .filter((component) => component.kind === "skill")
    .filter((component) => !activatedNames.has(component.id))
    .map((component) => missingSkill(component));

  return {
    readiness: [...activatedReadiness, ...missingDeclaredSkills],
    issues
  };
}

function readyConnectors(readiness: WorkPackConnectorReadiness[]): string[] {
  return readiness
    .filter((connector) => connector.status === "ready")
    .map((connector) => connector.connector);
}

function missingSkill(component: WorkPackComponent): WorkPackSkillReadiness {
  return {
    skill: component.id,
    status: "missing",
    requiredEnv: [],
    missingEnv: [],
    requiredConnectors: [],
    missingConnectors: [],
    requiredTools: [],
    missingTools: [],
    requiredWorkers: [],
    missingWorkers: [],
    fallbackForConnectors: [],
    suppressedByConnectors: [],
    fallbackForTools: [],
    suppressedByTools: [],
    reason: "work pack declares this skill, but no matching activation is loaded"
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
