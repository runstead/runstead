import {
  createStartupSourceRefreshPlan,
  formatStartupSourceRefreshPlan
} from "../startup-source-refresh-plan.js";

export interface StartupSourcePlanCommandOptions {
  cwd?: string;
  target: string;
  format?: string;
}

export async function planStartupSourceCommand(
  options: StartupSourcePlanCommandOptions
): Promise<void> {
  await Promise.resolve();

  const plan = createStartupSourceRefreshPlan({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    target: options.target
  });

  if (options.format === "json") {
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  if (options.format !== undefined && options.format !== "text") {
    throw new Error(`Unsupported startup source plan format: ${options.format}`);
  }

  console.log(formatStartupSourceRefreshPlan(plan));
}
