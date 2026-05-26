import type { StartupUiFlowAction } from "./startup-ui-validation.js";

export function cdpFlowActionExpression(action: StartupUiFlowAction): string {
  return `
(() => {
  const action = ${JSON.stringify(action)};
  const selectors = [...(action.selectors || []), ...(action.selector ? [action.selector] : [])];
  const bySelector = (selector) => {
    if (selector.startsWith("text=")) {
      const needle = selector.slice(5);
      return [...document.querySelectorAll("body *")].find((node) => (node.innerText || node.textContent || "").includes(needle));
    }
    const hasText = selector.match(/^(.+):has-text\\(["'](.+)["']\\)$/);
    if (hasText) {
      return [...document.querySelectorAll(hasText[1])].find((node) => (node.innerText || node.textContent || "").includes(hasText[2]));
    }
    try {
      return document.querySelector(selector);
    } catch {
      return null;
    }
  };
  const first = () => {
    for (const selector of selectors) {
      const node = bySelector(selector);
      if (node) return { node, selector };
    }
    return null;
  };
  const bodyText = () => document.body ? document.body.innerText || document.body.textContent || "" : "";
  const pass = (summary, extra = {}) => ({ type: action.type, status: "pass", summary, ...extra });
  const fail = (summary, extra = {}) => ({ type: action.type, status: "fail", summary, ...extra });

  if (action.type === "fill") {
    const found = first();
    if (!found) return fail("No matching selector found", { expected: action.value });
    found.node.focus();
    found.node.value = action.value;
    found.node.dispatchEvent(new Event("input", { bubbles: true }));
    found.node.dispatchEvent(new Event("change", { bubbles: true }));
    return pass("filled " + found.selector, { selector: found.selector, expected: action.value });
  }
  if (action.type === "select") {
    const found = first();
    if (!found) return fail("No matching selector found", { expected: action.value });
    found.node.value = action.value;
    found.node.dispatchEvent(new Event("change", { bubbles: true }));
    return pass("selected " + action.value, { selector: found.selector, expected: action.value });
  }
  if (action.type === "click") {
    const found = first();
    if (!found) return fail("No matching selector found");
    found.node.click();
    return pass("clicked " + found.selector, { selector: found.selector });
  }
  if (action.type === "expectText") {
    const found = bodyText().includes(action.text);
    return found ? pass("found " + action.text, { expected: action.text }) : fail("missing " + action.text, { expected: action.text });
  }
  if (action.type === "expectCount") {
    const actual = document.querySelectorAll(action.selector).length;
    return actual === action.count ? pass("expected " + action.count + ", found " + actual, { selector: action.selector, expected: action.count, actual }) : fail("expected " + action.count + ", found " + actual, { selector: action.selector, expected: action.count, actual });
  }
  if (action.type === "reload") {
    return pass("reload requested");
  }
  if (action.type === "expectPersisted") {
    const found = bodyText().includes(action.text);
    return found ? pass("persisted " + action.text, { expected: action.text }) : fail("missing persisted " + action.text, { expected: action.text });
  }
  if (action.type === "expectNoOverlap") {
    const boxes = selectors
      .map((selector) => {
        const node = bySelector(selector);
        if (!node) return null;
        const rect = node.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return null;
        return {
          selector,
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom
        };
      })
      .filter(Boolean);
    for (let index = 0; index < boxes.length; index += 1) {
      for (let next = index + 1; next < boxes.length; next += 1) {
        const first = boxes[index];
        const second = boxes[next];
        const width = Math.min(first.right, second.right) - Math.max(first.left, second.left);
        const height = Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top);
        if (width > 1 && height > 1) {
          return fail("overlap between " + first.selector + " and " + second.selector, { expected: "no-overlap", actual: Math.round(width) + "x" + Math.round(height) });
        }
      }
    }
    return pass("no overlap across " + boxes.length + " visible controls", { expected: "no-overlap", actual: boxes.length + " visible controls" });
  }
  return fail("Unsupported action type: " + action.type);
})()
`;
}
