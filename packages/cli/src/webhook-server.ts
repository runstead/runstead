import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

export interface WebhookRequest {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
  secret?: string;
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
  handler?: WebhookEventHandler;
}

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

  try {
    const payload = JSON.parse(request.body) as unknown;

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
    return jsonResponse(400, { error: "invalid_json" });
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
  const body = await readRequestBody(request);
  const result = await handleWebhookRequest(
    {
      method: request.method ?? "GET",
      url: request.url ?? "/",
      headers: request.headers,
      body,
      ...(options.secret === undefined ? {} : { secret: options.secret })
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

function readRequestBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];

    request.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    request.on("error", reject);
    request.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
  });
}

function writeResponse(response: ServerResponse, result: WebhookResponse): void {
  response.statusCode = result.statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(result.body);
}
