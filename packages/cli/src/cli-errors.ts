export class RunsteadCliError extends Error {
  readonly hint: string | undefined;

  constructor(message: string, hint?: string) {
    super(message);
    this.name = "Error";
    this.hint = hint;
  }
}

export function formatCliError(
  error: unknown,
  options: { debug?: boolean } = {}
): string {
  if (options.debug === true && error instanceof Error && error.stack !== undefined) {
    return error.stack;
  }

  const message = error instanceof Error ? error.message : String(error);
  const hint = error instanceof RunsteadCliError ? error.hint : undefined;

  return [`Error: ${message}`, ...(hint === undefined ? [] : [`Hint: ${hint}`])].join(
    "\n"
  );
}
