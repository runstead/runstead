import { randomUUID } from "node:crypto";

export type RunsteadIdPrefix =
  | "goal"
  | "task"
  | "ev"
  | "evt"
  | "poldec"
  | "wrun"
  | "tool"
  | "appr"
  | "mem"
  | "retr"
  | "repo";

export function createRunsteadId(prefix: RunsteadIdPrefix): string {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}
