import type { IncomingMessage, ServerResponse } from "node:http";

import type { JsonObject } from "@runstead/core";

export class DashboardOperatorApiHttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

export async function readJsonRequestBody(
  request: IncomingMessage
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();

  if (raw.length === 0) {
    return {};
  }

  const parsed = JSON.parse(raw) as unknown;

  if (!isRecord(parsed)) {
    throw new Error("JSON request body must be an object.");
  }

  return parsed;
}

export function respondJson(
  response: ServerResponse,
  statusCode: number,
  body: JsonObject,
  headers: Record<string, string> = {}
): void {
  response.writeHead(statusCode, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    ...headers
  });
  response.end(`${JSON.stringify(body, null, 2)}\n`);
}

export function dashboardOperatorApiError(
  error: unknown
): DashboardOperatorApiHttpError {
  if (error instanceof DashboardOperatorApiHttpError) {
    return error;
  }

  return new DashboardOperatorApiHttpError(
    500,
    "operator_action_failed",
    error instanceof Error ? error.message : String(error)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
