import type { JsonObject } from "@runstead/core";

export function goalScope(input: {
  repositoryPath: string;
  repositoryId?: string;
  repositoryAlias?: string;
  templateId: string;
  recurringTasks: string[];
  acceptanceContracts: string[];
}): JsonObject {
  return {
    repositoryPath: input.repositoryPath,
    ...(input.repositoryId === undefined ? {} : { repositoryId: input.repositoryId }),
    ...(input.repositoryAlias === undefined
      ? {}
      : { repositoryAlias: input.repositoryAlias }),
    templateId: input.templateId,
    recurringTasks: input.recurringTasks,
    acceptanceContracts: input.acceptanceContracts
  };
}
