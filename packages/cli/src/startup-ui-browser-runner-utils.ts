export async function waitForText(
  readText: () => Promise<string>,
  text: string,
  timeoutMs: number
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let latest = "";

  while (Date.now() < deadline) {
    try {
      latest = await readText();
    } catch {
      latest = "";
    }

    if (latest.includes(text)) {
      return latest;
    }

    await sleep(100);
  }

  return latest;
}

export function viewportSize(viewport: string): { width: number; height: number } {
  const match = /^(?<width>\d+)x(?<height>\d+)$/i.exec(viewport.trim());

  if (match?.groups !== undefined) {
    return {
      width: Number(match.groups.width),
      height: Number(match.groups.height)
    };
  }

  return viewport === "mobile"
    ? { width: 390, height: 844 }
    : { width: 1280, height: 800 };
}

export function dynamicImport(specifier: string): Promise<unknown> {
  return import(specifier) as Promise<unknown>;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => {
    setTimeout(resolveSleep, ms);
  });
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
