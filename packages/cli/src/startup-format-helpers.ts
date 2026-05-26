export function listItems(items: string[]): string {
  return items.map((item) => `- ${item}`).join("\n");
}

export function formatDetectedCommand(command: {
  detected: boolean;
  command?: string;
}): string {
  return command.detected ? (command.command ?? "detected") : "missing";
}

export function listItemsOrNone(items: string[]): string {
  return items.length === 0 ? "- none" : listItems(items);
}

export function safeTimestamp(value: string): string {
  return value.replace(/[:.]/g, "-");
}
