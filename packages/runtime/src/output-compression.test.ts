import { describe, expect, it } from "vitest";

import {
  compressRuntimeOutput,
  redactRuntimeOutputJson,
  redactRuntimeOutputText,
  runtimeOutputCompressionRule
} from "./output-compression.js";

describe("runtime output compression", () => {
  it("uses use-case defaults with explicit overrides", () => {
    expect(runtimeOutputCompressionRule("connector_payload")).toMatchObject({
      maxChars: 4000,
      redactTokenLikeValues: true
    });
    expect(
      runtimeOutputCompressionRule("worker_output", {
        maxChars: 120
      })
    ).toMatchObject({
      useCase: "worker_output",
      maxChars: 120
    });
  });

  it("redacts explicit secrets and token-like text", () => {
    const redacted = redactRuntimeOutputText({
      value: "Authorization: Bearer abcdefghijkl token=secret-value plain",
      secrets: ["plain"]
    });

    expect(redacted).toContain("Authorization: [redacted]");
    expect(redacted).toContain("token=[redacted]");
    expect(redacted).not.toContain("abcdefghijkl");
    expect(redacted).not.toContain("plain");
  });

  it("redacts sensitive JSON fields while preserving non-sensitive evidence", () => {
    expect(
      redactRuntimeOutputJson({
        value: {
          status: "passed",
          token: "secret",
          nested: {
            apiKey: "secret",
            summary: "ok"
          }
        }
      })
    ).toEqual({
      status: "passed",
      token: "[redacted]",
      nested: {
        apiKey: "[redacted]",
        summary: "ok"
      }
    });
  });

  it("compresses JSON outputs deterministically for connector payloads", () => {
    const result = compressRuntimeOutput({
      useCase: "connector_payload",
      value: {
        z: "last",
        token: "secret",
        a: "first"
      },
      rule: {
        maxChars: 80
      }
    });

    expect(result.text).toContain('"a": "first"');
    expect(result.text).toContain('"token": "[redacted]"');
    expect(result.text.indexOf('"a"')).toBeLessThan(result.text.indexOf('"z"'));
  });

  it("truncates long worker output with head and tail context", () => {
    const result = compressRuntimeOutput({
      useCase: "worker_output",
      value: `${"a".repeat(120)}${"b".repeat(120)}`,
      rule: {
        maxChars: 90
      }
    });

    expect(result.truncated).toBe(true);
    expect(result.text).toContain("[... truncated");
    expect(result.text).toMatch(/^a+/u);
    expect(result.text).toMatch(/b+$/u);
  });
});
