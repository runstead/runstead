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
  | "chk"
  | "mem"
  | "retr"
  | "repo";

export function createRunsteadId(prefix: RunsteadIdPrefix): string {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}
