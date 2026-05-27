import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";

import type { BuildDashboardResult } from "./dashboard-types.js";

export async function serveDashboardStaticRequest(input: {
  build: BuildDashboardResult;
  pathname: string;
  request: IncomingMessage;
  response: ServerResponse;
}): Promise<void> {
  if (
    input.request.method !== undefined &&
    !["GET", "HEAD"].includes(input.request.method)
  ) {
    input.response.writeHead(405, {
      allow: "GET, HEAD",
      "content-type": "text/plain; charset=utf-8"
    });
    input.response.end("Method not allowed");
    return;
  }

  const target = dashboardStaticFileTarget(input.build, input.pathname);

  if (target === undefined) {
    input.response.writeHead(404, {
      "content-type": "text/plain; charset=utf-8"
    });
    input.response.end("Not found");
    return;
  }

  try {
    const body = await readFile(target.path);

    input.response.writeHead(200, {
      "cache-control": "no-store",
      "content-type": target.contentType
    });
    input.response.end(input.request.method === "HEAD" ? undefined : body);
  } catch (error) {
    input.response.writeHead(500, {
      "content-type": "text/plain; charset=utf-8"
    });
    input.response.end(error instanceof Error ? error.message : String(error));
  }
}

function dashboardStaticFileTarget(
  build: BuildDashboardResult,
  pathname: string
): { path: string; contentType: string } | undefined {
  if (pathname === "/" || pathname === "/index.html") {
    return {
      path: build.htmlPath,
      contentType: "text/html; charset=utf-8"
    };
  }

  if (pathname === "/state.json") {
    return {
      path: build.dataPath,
      contentType: "application/json; charset=utf-8"
    };
  }

  if (pathname === "/operator-actions.json") {
    return {
      path: build.operatorActionsPath,
      contentType: "application/json; charset=utf-8"
    };
  }

  return undefined;
}
