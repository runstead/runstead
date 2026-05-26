import {
  arrayOfStrings,
  isRecord,
  requiredNumberValue,
  requiredStringValue,
  stringValue,
  unique
} from "./startup-ready-ui-smoke-config-values.js";
import type { StartupUiFlowAction } from "./startup-ui-validation-types.js";

export function parseStartupReadyUiSmokeSteps(value: unknown): StartupUiFlowAction[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item, index) => parseStartupReadyUiSmokeStep(item, index));
}

function parseStartupReadyUiSmokeStep(
  value: unknown,
  index: number
): StartupUiFlowAction {
  if (!isRecord(value)) {
    throw new Error(`UI smoke flow step ${index + 1} must be an object`);
  }

  const type = stringValue(value.type);
  const normalized =
    type === undefined && Object.keys(value).length === 1
      ? keyedFlowAction(value)
      : value;
  const normalizedType = stringValue(normalized.type);

  switch (normalizedType) {
    case "fill":
      return {
        type: "fill",
        ...flowSelectors(normalized),
        value: requiredStringValue(normalized.value, `UI smoke fill ${index + 1}`)
      };
    case "select":
      return {
        type: "select",
        ...flowSelectors(normalized),
        value: requiredStringValue(normalized.value, `UI smoke select ${index + 1}`)
      };
    case "click":
      return {
        type: "click",
        ...flowSelectors(normalized)
      };
    case "expectText":
      return {
        type: "expectText",
        text: requiredStringValue(
          normalized.text ?? normalized.value,
          `UI smoke expectText ${index + 1}`
        )
      };
    case "expectCount":
      return {
        type: "expectCount",
        selector: requiredStringValue(
          normalized.selector,
          `UI smoke expectCount selector ${index + 1}`
        ),
        count: requiredNumberValue(
          normalized.count,
          `UI smoke expectCount count ${index + 1}`
        )
      };
    case "reload":
      return {
        type: "reload"
      };
    case "expectPersisted":
      return {
        type: "expectPersisted",
        text: requiredStringValue(
          normalized.text ?? normalized.value,
          `UI smoke expectPersisted ${index + 1}`
        ),
        ...flowSelectors(normalized)
      };
    case "expectNoOverlap":
      return {
        type: "expectNoOverlap",
        selectors: requiredSelectorList(
          normalized,
          `UI smoke expectNoOverlap selectors ${index + 1}`
        )
      };
    default:
      throw new Error(
        `Unsupported UI smoke flow step ${index + 1}: ${String(normalizedType)}`
      );
  }
}

function keyedFlowAction(value: Record<string, unknown>): Record<string, unknown> {
  const [type, payload] = Object.entries(value)[0] ?? [];

  return isRecord(payload) ? { type, ...payload } : { type, value: payload };
}

function flowSelectors(value: Record<string, unknown>): {
  selector?: string;
  selectors?: string[];
} {
  return {
    ...(typeof value.selector === "string" ? { selector: value.selector } : {}),
    ...(!Array.isArray(value.selectors)
      ? {}
      : { selectors: arrayOfStrings(value.selectors) })
  };
}

function requiredSelectorList(value: Record<string, unknown>, label: string): string[] {
  const selectors = unique([
    ...arrayOfStrings(value.selectors),
    ...(typeof value.selector === "string" ? [value.selector] : [])
  ]);

  if (selectors.length === 0) {
    throw new Error(`${label} must include at least one selector`);
  }

  return selectors;
}
