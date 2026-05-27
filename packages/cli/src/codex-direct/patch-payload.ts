import type { ActionEnvelope } from "../policy.js";
import { parseCodexDirectPendingPatchPayload } from "./patch-payload-parser.js";
import type { ActionEnvelopeWithPendingPatch } from "./patch-payload-types.js";
import { isRecord } from "./tool-json.js";

export {
  cloneCodexResponsesMessages,
  optionalParsedResumeContext,
  parseCodexDirectPendingToolResumeContext,
  parseCodexResponsesFunctionCallInputItem,
  parseCodexResponsesInputItem,
  parseCodexResponsesInputItems,
  stringArray
} from "./patch-payload-parsers.js";
export type {
  ActionEnvelopeWithPendingPatch,
  CodexDirectPendingPatchPayload,
  CodexDirectPendingToolResumeContext
} from "./patch-payload-types.js";
export { codexDirectPendingPatchPayload } from "./patch-payload-builder.js";
export { parseCodexDirectPendingPatchPayload } from "./patch-payload-parser.js";

export function parsePendingPatchAction(
  actionJson: string
): ActionEnvelopeWithPendingPatch | undefined {
  let parsed: unknown;

  try {
    parsed = JSON.parse(actionJson) as unknown;
  } catch {
    return undefined;
  }

  if (!isRecord(parsed) || parsed.actionType !== "filesystem.patch") {
    return undefined;
  }

  const context = isRecord(parsed.context) ? parsed.context : undefined;
  const pendingPatch = parseCodexDirectPendingPatchPayload(context?.pendingPatch);

  if (
    typeof parsed.actionId !== "string" ||
    typeof parsed.actionType !== "string" ||
    pendingPatch === undefined
  ) {
    return undefined;
  }

  let resource: ActionEnvelope["resource"];

  if (isRecord(parsed.resource)) {
    if (typeof parsed.resource.type !== "string") {
      return undefined;
    }

    resource = {
      type: parsed.resource.type,
      ...(typeof parsed.resource.id === "string" ? { id: parsed.resource.id } : {}),
      ...(typeof parsed.resource.path === "string"
        ? { path: parsed.resource.path }
        : {})
    };
  }

  return {
    actionId: parsed.actionId,
    actionType: parsed.actionType,
    ...(resource === undefined ? {} : { resource }),
    context: {
      ...(context ?? {}),
      pendingPatch
    }
  };
}
