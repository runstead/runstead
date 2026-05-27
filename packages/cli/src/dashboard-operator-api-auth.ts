import type { IncomingMessage } from "node:http";

import type { JsonObject } from "@runstead/core";

import type { DashboardOperatorApiSession } from "./dashboard-types.js";

export function dashboardOperatorApiAuthError(
  request: IncomingMessage,
  operatorApi: DashboardOperatorApiSession
): JsonObject | undefined {
  if (!localRemoteAddress(request.socket.remoteAddress)) {
    return {
      error: "non_local_request",
      message: "Operator API only accepts local requests."
    };
  }

  if (!sameOriginRequest(request)) {
    return {
      error: "origin_denied",
      message: "Operator API rejected a cross-origin request."
    };
  }

  const sessionToken =
    headerValue(request.headers["x-runstead-session-token"]) ??
    bearerToken(headerValue(request.headers.authorization));

  if (sessionToken !== operatorApi.sessionToken) {
    return {
      error: "invalid_session",
      message: "Operator API session token is missing or invalid."
    };
  }

  if (headerValue(request.headers["x-runstead-csrf-token"]) !== operatorApi.csrfToken) {
    return {
      error: "invalid_csrf",
      message: "Operator API CSRF token is missing or invalid."
    };
  }

  return undefined;
}

export function localBindHost(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

function bearerToken(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const match = /^Bearer\s+(.+)$/i.exec(value);

  return match?.[1];
}

function sameOriginRequest(request: IncomingMessage): boolean {
  const origin = headerValue(request.headers.origin);

  if (origin === undefined) {
    return true;
  }

  const host = headerValue(request.headers.host);

  if (host === undefined) {
    return false;
  }

  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function localRemoteAddress(address: string | undefined): boolean {
  return (
    address === undefined ||
    address === "127.0.0.1" ||
    address === "::1" ||
    address === "::ffff:127.0.0.1"
  );
}
