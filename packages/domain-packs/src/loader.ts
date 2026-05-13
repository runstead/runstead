import { join } from "node:path";

import type { DomainPack } from "./domain-pack.js";
import { loadDomainPackFromFile } from "./domain-pack.js";
import type { GoalTemplate } from "./goal-template.js";
import { loadGoalTemplateFromFile } from "./goal-template.js";

export interface DomainPackBundle {
  root: string;
  domain: DomainPack;
  goalTemplates: GoalTemplate[];
  defaultVerifiers: string[];
}

export async function loadDomainPackBundleFromDir(
  root: string
): Promise<DomainPackBundle> {
  const domain = await loadDomainPackFromFile(join(root, "domain.yaml"));
  const goalTemplates = await Promise.all(
    domain.goalTemplates.map((templateId) =>
      loadGoalTemplateFromFile(join(root, "goal-templates", `${templateId}.yaml`))
    )
  );

  for (const template of goalTemplates) {
    if (template.domain !== domain.id) {
      throw new Error(
        `Goal template ${template.id} belongs to ${template.domain}, expected ${domain.id}`
      );
    }
  }

  return {
    root,
    domain,
    goalTemplates,
    defaultVerifiers: domain.defaultVerifiers
  };
}
