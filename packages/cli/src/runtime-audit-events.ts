import { createRunsteadId, type JsonObject, type RunsteadEvent } from "@runstead/core";

export function runtimeEvent(
  type: string,
  aggregateType: string,
  aggregateId: string,
  payload: JsonObject,
  createdAt: string
): RunsteadEvent {
  return {
    eventId: createRunsteadId("evt"),
    type,
    aggregateType,
    aggregateId,
    payload,
    createdAt
  };
}

export function jsonObject(value: unknown): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}
