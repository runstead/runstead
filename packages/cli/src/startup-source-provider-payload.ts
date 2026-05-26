import {
  collectRuntimeSourceProviderPayload,
  parseRuntimeSourceConnectorResponseJson,
  runtimeSourceProviderAuthHeaders,
  type RuntimeSourceConnectorResponseJsonParseResult,
  type RuntimeSourceProviderCollection
} from "@runstead/runtime";

import type {
  StartupSourceConnectorDefinition,
  StartupSourceProviderAdapter
} from "./startup-source-connector-definitions.js";

export type StartupSourceProviderCollection = RuntimeSourceProviderCollection;
export type StartupSourceConnectorResponseJsonParseResult =
  RuntimeSourceConnectorResponseJsonParseResult;

export function parseStartupSourceConnectorResponseJson(
  value: string,
  options?: {
    secrets?: string[];
  }
): StartupSourceConnectorResponseJsonParseResult {
  return parseRuntimeSourceConnectorResponseJson(value, options);
}

export function startupSourceProviderAuthHeaders(
  adapter: StartupSourceProviderAdapter,
  token: string
): Record<string, string> {
  return runtimeSourceProviderAuthHeaders(adapter, token);
}

export function collectStartupSourceProviderPayload(input: {
  adapter: StartupSourceProviderAdapter;
  definition: StartupSourceConnectorDefinition;
  responseStatus: number;
  responseOk: boolean;
  responsePayload: Record<string, unknown>;
  parseError?: string;
  responseExcerpt?: string;
}): StartupSourceProviderCollection {
  return collectRuntimeSourceProviderPayload(input);
}
