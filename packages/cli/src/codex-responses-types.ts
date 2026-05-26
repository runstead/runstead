export interface CodexResponsesTransportOptions {
  baseUrl?: string;
  accessToken: string;
  fetch?: FetchLike;
}

export interface CodexResponsesRequest {
  model: string;
  instructions: string;
  input: CodexResponsesInputItem[];
  tools?: CodexResponsesTool[];
  sessionId?: string;
  reasoningEffort?: "low" | "medium" | "high" | "xhigh";
  maxOutputTokens?: number;
}

export type CodexResponsesInputItem =
  | CodexResponsesMessageInputItem
  | CodexResponsesFunctionCallInputItem
  | CodexResponsesFunctionCallOutputInputItem;

export interface CodexResponsesMessageInputItem {
  role: "user" | "assistant";
  content: string;
}

export interface CodexResponsesFunctionCallInputItem {
  type: "function_call";
  call_id: string;
  name: string;
  arguments: string;
}

export interface CodexResponsesFunctionCallOutputInputItem {
  type: "function_call_output";
  call_id: string;
  output: string;
}

export interface CodexResponsesTool {
  type: "function";
  name: string;
  description: string;
  strict: boolean;
  parameters: Record<string, unknown>;
}

export interface CodexResponsesToolCall {
  id: string;
  name: string;
  arguments: string;
  responseItemId?: string;
}

export interface CodexResponsesResult {
  id?: string;
  status?: string;
  outputText: string;
  toolCalls: CodexResponsesToolCall[];
  finishReason: "stop" | "tool_calls" | "incomplete";
  outputItems: unknown[];
}

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
