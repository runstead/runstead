import type { JsonObject } from "@runstead/core";

export type RuntimeOutputCompressionUseCase =
  | "connector_payload"
  | "worker_output"
  | "model_output"
  | "evidence_excerpt"
  | "verifier_output";

export interface RuntimeOutputCompressionRule {
  useCase: RuntimeOutputCompressionUseCase;
  maxChars: number;
  redactTokenLikeValues: boolean;
  redactFields: string[];
}

export interface RuntimeOutputCompressionResult {
  text: string;
  rule: RuntimeOutputCompressionRule;
  originalChars: number;
  compressedChars: number;
  truncated: boolean;
  redacted: boolean;
}

const DEFAULT_REDACT_FIELDS = [
  "authorization",
  "api_key",
  "apikey",
  "access_token",
  "refresh_token",
  "token",
  "secret",
  "password",
  "bearer"
];

const DEFAULT_RULES: Record<
  RuntimeOutputCompressionUseCase,
  RuntimeOutputCompressionRule
> = {
  connector_payload: {
    useCase: "connector_payload",
    maxChars: 4_000,
    redactTokenLikeValues: true,
    redactFields: DEFAULT_REDACT_FIELDS
  },
  worker_output: {
    useCase: "worker_output",
    maxChars: 8_000,
    redactTokenLikeValues: true,
    redactFields: DEFAULT_REDACT_FIELDS
  },
  model_output: {
    useCase: "model_output",
    maxChars: 6_000,
    redactTokenLikeValues: true,
    redactFields: DEFAULT_REDACT_FIELDS
  },
  evidence_excerpt: {
    useCase: "evidence_excerpt",
    maxChars: 3_000,
    redactTokenLikeValues: true,
    redactFields: DEFAULT_REDACT_FIELDS
  },
  verifier_output: {
    useCase: "verifier_output",
    maxChars: 12_000,
    redactTokenLikeValues: true,
    redactFields: DEFAULT_REDACT_FIELDS
  }
};

export function runtimeOutputCompressionRule(
  useCase: RuntimeOutputCompressionUseCase,
  overrides: Partial<Omit<RuntimeOutputCompressionRule, "useCase">> = {}
): RuntimeOutputCompressionRule {
  const base = DEFAULT_RULES[useCase];

  return {
    ...base,
    ...overrides,
    useCase,
    redactFields: overrides.redactFields ?? [...base.redactFields]
  };
}

export function compressRuntimeOutput(input: {
  value: string | JsonObject;
  useCase: RuntimeOutputCompressionUseCase;
  secrets?: string[];
  rule?: Partial<Omit<RuntimeOutputCompressionRule, "useCase">>;
}): RuntimeOutputCompressionResult {
  const rule = runtimeOutputCompressionRule(input.useCase, input.rule);
  const originalText =
    typeof input.value === "string"
      ? input.value
      : stableJsonStringify(
          redactRuntimeOutputJson({
            value: input.value,
            secrets: input.secrets ?? [],
            rule
          })
        );
  const originalChars = originalText.length;
  const redactedText =
    typeof input.value === "string"
      ? redactRuntimeOutputText({
          value: originalText,
          secrets: input.secrets ?? [],
          rule
        })
      : originalText;
  const compressedText = truncateMiddle(redactedText, rule.maxChars);

  return {
    text: compressedText,
    rule,
    originalChars,
    compressedChars: compressedText.length,
    truncated: redactedText.length > rule.maxChars,
    redacted: redactedText !== originalText
  };
}

export function redactRuntimeOutputJson(input: {
  value: JsonObject;
  secrets?: string[];
  rule?: RuntimeOutputCompressionRule;
}): JsonObject {
  const rule = input.rule ?? runtimeOutputCompressionRule("connector_payload");

  return redactJsonValue({
    value: input.value,
    secrets: input.secrets ?? [],
    rule
  }) as JsonObject;
}

export function redactRuntimeOutputText(input: {
  value: string;
  secrets?: string[];
  rule?: RuntimeOutputCompressionRule;
}): string {
  const rule = input.rule ?? runtimeOutputCompressionRule("connector_payload");
  const explicitRedacted = (input.secrets ?? [])
    .filter((secret) => secret.trim().length > 0)
    .reduce(
      (redacted, secret) => redacted.split(secret).join("[redacted]"),
      input.value
    );

  if (!rule.redactTokenLikeValues) {
    return explicitRedacted;
  }

  return explicitRedacted
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/giu, "$1[redacted]")
    .replace(
      /\b((?:authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password)\s*[:=]\s*)["']?[^"',\s}]+["']?/giu,
      "$1[redacted]"
    );
}

function redactJsonValue(input: {
  value: unknown;
  secrets: string[];
  rule: RuntimeOutputCompressionRule;
}): unknown {
  if (typeof input.value === "string") {
    return redactRuntimeOutputText({
      value: input.value,
      secrets: input.secrets,
      rule: input.rule
    });
  }

  if (Array.isArray(input.value)) {
    return input.value.map((item) =>
      redactJsonValue({
        value: item,
        secrets: input.secrets,
        rule: input.rule
      })
    );
  }

  if (typeof input.value === "object" && input.value !== null) {
    return Object.fromEntries(
      Object.entries(input.value).map(([key, value]) => [
        key,
        sensitiveField(key, input.rule.redactFields)
          ? "[redacted]"
          : redactJsonValue({
              value,
              secrets: input.secrets,
              rule: input.rule
            })
      ])
    );
  }

  return input.value;
}

function sensitiveField(key: string, fields: string[]): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/gu, "");

  return fields.some(
    (field) => normalized === field.toLowerCase().replace(/[^a-z0-9]/gu, "")
  );
}

function truncateMiddle(value: string, maxChars: number): string {
  if (maxChars <= 0 || value.length <= maxChars) {
    return maxChars <= 0 ? "" : value;
  }

  const marker = `\n[... truncated ${value.length - maxChars} chars ...]\n`;
  const available = Math.max(0, maxChars - marker.length);
  const headLength = Math.ceil(available * 0.7);
  const tailLength = available - headLength;

  return `${value.slice(0, headLength)}${marker}${value.slice(value.length - tailLength)}`;
}

function stableJsonStringify(value: JsonObject): string {
  return JSON.stringify(sortJsonValue(value), null, 2);
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue);
  }

  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, sortJsonValue(entry)])
    );
  }

  return value;
}
