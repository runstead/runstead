import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

export interface WebhookRequest {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
  secret?: string;
  allowUnsigned?: boolean;
  maxBodyBytes?: number;
}

export interface WebhookResponse {
  statusCode: number;
  body: string;
}

export interface GitHubWebhookEvent {
  event: string;
  delivery: string;
  payload: unknown;
}

export type WebhookEventHandler = (event: GitHubWebhookEvent) => void | Promise<void>;

export interface CreateWebhookServerOptions {
  secret?: string;
  allowUnsigned?: boolean;
  maxBodyBytes?: number;
  handler?: WebhookEventHandler;
}

const DEFAULT_MAX_WEBHOOK_BODY_BYTES = 1024 * 1024;

export async function handleWebhookRequest(
  request: WebhookRequest,
  handler: WebhookEventHandler = () => undefined
): Promise<WebhookResponse> {
  const url = new URL(request.url, "http://runstead.local");

  if (request.method !== "POST") {
    return jsonResponse(405, { error: "method_not_allowed" });
  }

  if (url.pathname !== "/webhooks/github") {
    return jsonResponse(404, { error: "not_found" });
  }

  const maxBodyBytes = request.maxBodyBytes ?? DEFAULT_MAX_WEBHOOK_BODY_BYTES;

  if (Buffer.byteLength(request.body, "utf8") > maxBodyBytes) {
    return jsonResponse(413, { error: "body_too_large", maxBodyBytes });
  }

  if (request.secret === undefined && request.allowUnsigned !== true) {
    return jsonResponse(401, { error: "missing_signature_secret" });
  }

  if (
    request.secret !== undefined &&
    !verifyGitHubSignature({
      body: request.body,
      signature: headerValue(request.headers["x-hub-signature-256"]),
      secret: request.secret
    })
  ) {
    return jsonResponse(401, { error: "invalid_signature" });
  }

  const event = headerValue(request.headers["x-github-event"]);
  const delivery = headerValue(request.headers["x-github-delivery"]);

  if (event === undefined || delivery === undefined) {
    return jsonResponse(400, { error: "missing_github_headers" });
  }

  let payload: unknown;

  try {
    payload = JSON.parse(request.body) as unknown;
  } catch {
    return jsonResponse(400, { error: "invalid_json" });
  }

  try {
    await handler({
      event,
      delivery,
      payload
    });

    return jsonResponse(202, {
      accepted: true,
      event,
      delivery
    });
  } catch {
    return jsonResponse(500, { error: "handler_failed" });
  }
}

export function createWebhookServer(options: CreateWebhookServerOptions = {}) {
  return createServer((request, response) => {
    void handleHttpWebhookRequest(request, response, options).catch(() => {
      writeResponse(response, jsonResponse(500, { error: "internal_error" }));
    });
  });
}

async function handleHttpWebhookRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: CreateWebhookServerOptions
): Promise<void> {
  let body: string;

  try {
    body = await readRequestBody(
      request,
      options.maxBodyBytes ?? DEFAULT_MAX_WEBHOOK_BODY_BYTES
    );
  } catch (error) {
    if (error instanceof WebhookBodyTooLargeError) {
      writeResponse(
        response,
        jsonResponse(413, {
          error: "body_too_large",
          maxBodyBytes: error.maxBodyBytes
        })
      );
      return;
    }

    throw error;
  }

  const result = await handleWebhookRequest(
    {
      method: request.method ?? "GET",
      url: request.url ?? "/",
      headers: request.headers,
      body,
      ...(options.secret === undefined ? {} : { secret: options.secret }),
      ...(options.allowUnsigned === undefined
        ? {}
        : { allowUnsigned: options.allowUnsigned }),
      ...(options.maxBodyBytes === undefined
        ? {}
        : { maxBodyBytes: options.maxBodyBytes })
    },
    options.handler
  );

  writeResponse(response, result);
}

export function gitHubSignature(body: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

function verifyGitHubSignature(input: {
  body: string;
  signature: string | undefined;
  secret: string;
}): boolean {
  if (input.signature === undefined) {
    return false;
  }

  const expected = Buffer.from(gitHubSignature(input.body, input.secret));
  const actual = Buffer.from(input.signature);

  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function jsonResponse(statusCode: number, body: unknown): WebhookResponse {
  return {
    statusCode,
    body: `${JSON.stringify(body)}\n`
  };
}

function readRequestBody(
  request: IncomingMessage,
  maxBodyBytes: number
): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let settled = false;

    request.on("data", (chunk: Buffer) => {
      totalBytes += chunk.byteLength;
      if (totalBytes > maxBodyBytes) {
        settled = true;
        request.destroy();
        reject(new WebhookBodyTooLargeError(maxBodyBytes));
        return;
      }

      chunks.push(chunk);
    });
    request.on("error", (error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
    request.on("end", () => {
      if (settled) {
        return;
      }

      settled = true;
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
  });
}

function writeResponse(response: ServerResponse, result: WebhookResponse): void {
  response.statusCode = result.statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(result.body);
}

class WebhookBodyTooLargeError extends Error {
  constructor(readonly maxBodyBytes: number) {
    super(`Webhook body exceeds ${maxBodyBytes} bytes`);
  }
}
