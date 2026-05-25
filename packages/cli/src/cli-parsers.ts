import { RunsteadCliError } from "./cli-errors.js";

export function parseRequiredPositiveInteger(
  value: string,
  optionName: string
): number {
  if (!/^[1-9]\d*$/.test(value)) {
    throw new RunsteadCliError(
      `${optionName} must be a positive integer`,
      `use ${optionName} 8`
    );
  }

  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed)) {
    throw new RunsteadCliError(
      `${optionName} must be a positive integer`,
      `use ${optionName} 8`
    );
  }

  return parsed;
}
