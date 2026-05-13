import { resolve } from "node:path";

export interface RunOnceOptions {
  cwd?: string;
}

export interface RunOnceResult {
  cwd: string;
  ranTask: false;
  reason: "no_task_selected";
}

export function runOnce(options: RunOnceOptions = {}): RunOnceResult {
  return {
    cwd: resolve(options.cwd ?? process.cwd()),
    ranTask: false,
    reason: "no_task_selected"
  };
}
