import { describe, expect, it } from "vitest";

import {
  gitHubSignature,
  handleWebhookRequest,
  type GitHubWebhookEvent
} from "./webhook-server.js";

describe("handleWebhookRequest", () => {
  it("accepts signed GitHub webhook requests", async () => {
    const body = JSON.stringify({ action: "completed" });
    const events: GitHubWebhookEvent[] = [];
    const response = await handleWebhookRequest(
      {
        method: "POST",
        url: "/webhooks/github",
        secret: "secret",
        headers: {
          "x-hub-signature-256": gitHubSignature(body, "secret"),
          "x-github-event": "workflow_run",
          "x-github-delivery": "delivery_001"
        },
        body
      },
      (event) => {
        events.push(event);
      }
    );

    expect(response.statusCode).toBe(202);
    expect(JSON.parse(response.body)).toMatchObject({
      accepted: true,
      event: "workflow_run",
      delivery: "delivery_001"
    });
    expect(events).toEqual([
      {
        event: "workflow_run",
        delivery: "delivery_001",
        payload: {
          action: "completed"
        }
      }
    ]);
  });

  it("rejects invalid signatures", async () => {
    const response = await handleWebhookRequest({
      method: "POST",
      url: "/webhooks/github",
      secret: "secret",
      headers: {
        "x-hub-signature-256": "sha256=bad",
        "x-github-event": "workflow_run",
        "x-github-delivery": "delivery_001"
      },
      body: "{}"
    });

    expect(response.statusCode).toBe(401);
  });

  it("rejects unsigned GitHub webhook requests by default", async () => {
    const response = await handleWebhookRequest({
      method: "POST",
      url: "/webhooks/github",
      headers: {
        "x-github-event": "workflow_run",
        "x-github-delivery": "delivery_001"
      },
      body: "{}"
    });

    expect(response.statusCode).toBe(401);
    expect(response.body).toContain("missing_signature_secret");
  });

  it("accepts unsigned requests only when explicitly allowed", async () => {
    const response = await handleWebhookRequest({
      method: "POST",
      url: "/webhooks/github",
      allowUnsigned: true,
      headers: {
        "x-github-event": "workflow_run",
        "x-github-delivery": "delivery_001"
      },
      body: "{}"
    });

    expect(response.statusCode).toBe(202);
  });

  it("reports malformed JSON separately from handler failures", async () => {
    const invalidJson = await handleWebhookRequest({
      method: "POST",
      url: "/webhooks/github",
      allowUnsigned: true,
      headers: {
        "x-github-event": "workflow_run",
        "x-github-delivery": "delivery_001"
      },
      body: "{"
    });
    const handlerFailure = await handleWebhookRequest(
      {
        method: "POST",
        url: "/webhooks/github",
        allowUnsigned: true,
        headers: {
          "x-github-event": "workflow_run",
          "x-github-delivery": "delivery_001"
        },
        body: "{}"
      },
      () => {
        throw new Error("handler failed");
      }
    );

    expect(invalidJson.statusCode).toBe(400);
    expect(invalidJson.body).toContain("invalid_json");
    expect(handlerFailure.statusCode).toBe(500);
    expect(handlerFailure.body).toContain("handler_failed");
  });

  it("rejects GitHub webhook bodies above the configured byte limit", async () => {
    const response = await handleWebhookRequest({
      method: "POST",
      url: "/webhooks/github",
      allowUnsigned: true,
      maxBodyBytes: 4,
      headers: {
        "x-github-event": "workflow_run",
        "x-github-delivery": "delivery_001"
      },
      body: '{"too":"large"}'
    });

    expect(response.statusCode).toBe(413);
    expect(response.body).toContain("body_too_large");
  });

  it("rejects non-GitHub routes", async () => {
    const response = await handleWebhookRequest({
      method: "POST",
      url: "/unknown",
      headers: {},
      body: "{}"
    });

    expect(response.statusCode).toBe(404);
  });
});
