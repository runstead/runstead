import { readFile } from "node:fs/promises";
import { join } from "node:path";

export async function inferStartupReadyUiSmokeExpectText(
  cwd: string
): Promise<string[]> {
  const [packageText, htmlTexts, readmeTexts] = await Promise.all([
    inferExpectTextFromPackageJson(cwd),
    inferExpectTextFromHtmlFiles(cwd),
    inferExpectTextFromReadme(cwd)
  ]);

  const inferred = unique([...htmlTexts, ...readmeTexts, ...packageText]).slice(0, 6);

  return inferred.length === 0 ? ["html"] : inferred;
}

async function inferExpectTextFromPackageJson(cwd: string): Promise<string[]> {
  try {
    const parsed = JSON.parse(
      await readFile(join(cwd, "package.json"), "utf8")
    ) as unknown;

    if (!isRecord(parsed) || typeof parsed.name !== "string") {
      return [];
    }

    const displayName = packageNameToDisplayText(parsed.name);

    return displayName.length === 0 ? [] : [displayName];
  } catch {
    return [];
  }
}

async function inferExpectTextFromHtmlFiles(cwd: string): Promise<string[]> {
  const paths = [
    join(cwd, "index.html"),
    join(cwd, "public", "index.html"),
    join(cwd, "src", "index.html")
  ];
  const texts: string[] = [];

  for (const path of paths) {
    const contents = await readOptionalTextFile(path);

    if (contents.length === 0) {
      continue;
    }

    texts.push(...extractHtmlSignalText(contents));
  }

  return texts;
}

async function inferExpectTextFromReadme(cwd: string): Promise<string[]> {
  for (const name of ["README.md", "readme.md"]) {
    const contents = await readOptionalTextFile(join(cwd, name));
    const match = /^#\s+(.+)$/m.exec(contents);
    const heading = match?.[1]?.trim();

    if (heading !== undefined && heading.length > 0) {
      return [heading];
    }
  }

  return [];
}

function extractHtmlSignalText(contents: string): string[] {
  const texts: string[] = [];
  const patterns = [
    /<title[^>]*>([^<]+)<\/title>/gi,
    /<h1[^>]*>([^<]+)<\/h1>/gi,
    /<button[^>]*>([^<]+)<\/button>/gi,
    /aria-label=["']([^"']+)["']/gi,
    /placeholder=["']([^"']+)["']/gi
  ];

  for (const pattern of patterns) {
    for (const match of contents.matchAll(pattern)) {
      const text = normalizeUiText(match[1]);

      if (text !== undefined) {
        texts.push(text);
      }
    }
  }

  return texts;
}

function packageNameToDisplayText(name: string): string {
  const unscoped = name.includes("/") ? (name.split("/").pop() ?? name) : name;

  return unscoped
    .split(/[-_\s]+/u)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function normalizeUiText(value: string | undefined): string | undefined {
  const text = value?.replace(/\s+/gu, " ").trim();

  return text === undefined || text.length === 0 ? undefined : text;
}

async function readOptionalTextFile(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
