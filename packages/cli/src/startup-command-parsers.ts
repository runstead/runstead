export function collectValues(value: string, previous: string[]): string[] {
  return [...previous, value];
}

export function emptyAsUndefined(values: string[]): string[] | undefined {
  return values.length === 0 ? undefined : values;
}

export function parseStartupGateStage(
  value: string
): "idea" | "mvp" | "launch" | "scale" {
  if (value === "idea" || value === "mvp" || value === "launch" || value === "scale") {
    return value;
  }

  throw new Error("--stage must be one of: idea, mvp, launch, scale");
}

export function parseStartupGateDecision(
  value: string
): "launch" | "no_launch" | "launch_with_accepted_debt" {
  if (
    value === "launch" ||
    value === "no_launch" ||
    value === "launch_with_accepted_debt"
  ) {
    return value;
  }

  throw new Error(
    "--decision must be one of: launch, no_launch, launch_with_accepted_debt"
  );
}

export function parseStartupAssessStages(
  value: string
): ("mvp" | "launch" | "scale")[] {
  if (value === "all") {
    return ["mvp", "launch", "scale"];
  }

  if (value === "mvp" || value === "launch" || value === "scale") {
    return [value];
  }

  throw new Error("--stage must be one of: all, mvp, launch, scale");
}

export function parseStartupInitStage(value: string): "mvp" | "launch" | "scale" {
  if (value === "mvp" || value === "launch" || value === "scale") {
    return value;
  }

  throw new Error("--stage must be one of: mvp, launch, scale");
}

export function parseStartupHypothesisKind(
  value: string
): "problem" | "user" | "solution" {
  if (value === "problem" || value === "user" || value === "solution") {
    return value;
  }

  throw new Error("--kind must be one of: problem, user, solution");
}

export function parseStartupHypothesisStatus(
  value: string
): "open" | "validated" | "invalidated" | "needs-more-evidence" {
  if (
    value === "open" ||
    value === "validated" ||
    value === "invalidated" ||
    value === "needs-more-evidence"
  ) {
    return value;
  }

  throw new Error(
    "--status must be one of: open, validated, invalidated, needs-more-evidence"
  );
}

export function parseLocalAgentWorker(
  value: string
): "codex_direct" | "codex_cli" | "claude_code" {
  if (value === "codex_direct" || value === "codex_cli" || value === "claude_code") {
    return value;
  }

  throw new Error("--worker must be one of: codex_direct, codex_cli, claude_code");
}

export function parsePositiveInteger(value: string, optionName: string): number {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${optionName} must be a positive integer`);
  }

  return parsed;
}

export function requireUiValidationUrl(value: string | undefined): string {
  if (value !== undefined && value.trim().length > 0) {
    return value;
  }

  throw new Error("--url is required unless --execute starts a dev server");
}
