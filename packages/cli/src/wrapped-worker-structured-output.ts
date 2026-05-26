export interface WrappedWorkerStructuredOutput {
  summary: string;
  files_changed: string[];
  commands_run: string[];
  risks: string[];
  needs_approval: boolean;
  approval_reason: string | null;
}

export interface WrappedWorkerOutputValidation {
  valid: boolean;
  reason?: string;
}

export const WRAPPED_WORKER_STRUCTURED_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    files_changed: { type: "array", items: { type: "string" } },
    commands_run: { type: "array", items: { type: "string" } },
    risks: { type: "array", items: { type: "string" } },
    needs_approval: { type: "boolean" },
    approval_reason: { type: ["string", "null"] }
  },
  required: [
    "summary",
    "files_changed",
    "commands_run",
    "risks",
    "needs_approval",
    "approval_reason"
  ],
  additionalProperties: false
};

export function validateWrappedWorkerStructuredOutput(
  stdout: string
): WrappedWorkerOutputValidation & { output?: WrappedWorkerStructuredOutput } {
  const trimmed = stdout.trim();

  if (trimmed.length === 0) {
    return {
      valid: false,
      reason: "worker produced no structured output"
    };
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return {
      valid: false,
      reason: "worker stdout is not valid JSON"
    };
  }

  const structuredCandidate = wrappedWorkerStructuredOutputCandidate(parsed);

  if (!isRecord(structuredCandidate)) {
    return {
      valid: false,
      reason: "worker JSON output must be an object"
    };
  }

  if (typeof structuredCandidate.summary !== "string") {
    return invalidWorkerOutputField("summary");
  }

  if (!isStringArray(structuredCandidate.files_changed)) {
    return invalidWorkerOutputField("files_changed");
  }

  if (!isStringArray(structuredCandidate.commands_run)) {
    return invalidWorkerOutputField("commands_run");
  }

  if (!isStringArray(structuredCandidate.risks)) {
    return invalidWorkerOutputField("risks");
  }

  if (typeof structuredCandidate.needs_approval !== "boolean") {
    return invalidWorkerOutputField("needs_approval");
  }

  if (
    structuredCandidate.approval_reason !== null &&
    typeof structuredCandidate.approval_reason !== "string"
  ) {
    return invalidWorkerOutputField("approval_reason");
  }

  return {
    valid: true,
    output: {
      summary: structuredCandidate.summary,
      files_changed: structuredCandidate.files_changed,
      commands_run: structuredCandidate.commands_run,
      risks: structuredCandidate.risks,
      needs_approval: structuredCandidate.needs_approval,
      approval_reason: structuredCandidate.approval_reason
    }
  };
}

function wrappedWorkerStructuredOutputCandidate(parsed: unknown): unknown {
  if (!isRecord(parsed)) {
    return parsed;
  }

  if (isRecord(parsed.structured_output)) {
    return parsed.structured_output;
  }

  if (isRecord(parsed.result)) {
    return parsed.result;
  }

  if (typeof parsed.result === "string") {
    const result = parsed.result.trim();

    if (result.length === 0) {
      return parsed;
    }

    try {
      return JSON.parse(result) as unknown;
    } catch {
      return parsed;
    }
  }

  return parsed;
}

function invalidWorkerOutputField(field: string): WrappedWorkerOutputValidation {
  return {
    valid: false,
    reason: `worker JSON output field ${field} is missing or invalid`
  };
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
