const SEARCH_TEXT_PREVIEW_LIMIT = 500;

export interface CodexDirectSearchTextContextLine {
  line: number;
  text: string;
}

export function createTextMatcher(
  query: string,
  options: { regex: boolean; caseSensitive: boolean }
): (line: string) => boolean {
  if (options.regex) {
    const expression = new RegExp(query, options.caseSensitive ? "" : "i");

    return (line) => expression.test(line);
  }

  const needle = options.caseSensitive ? query : query.toLowerCase();

  return (line) => (options.caseSensitive ? line : line.toLowerCase()).includes(needle);
}

export function contextForSearchTextMatch(
  lines: string[],
  index: number,
  contextLines: number
): {
  before?: CodexDirectSearchTextContextLine[];
  after?: CodexDirectSearchTextContextLine[];
} {
  if (contextLines <= 0) {
    return {};
  }

  const before = lines
    .slice(Math.max(0, index - contextLines), index)
    .map((line, offset, selected) => ({
      line: index - selected.length + offset + 1,
      text: truncateSearchTextPreview(line)
    }));
  const after = lines
    .slice(index + 1, index + 1 + contextLines)
    .map((line, offset) => ({
      line: index + offset + 2,
      text: truncateSearchTextPreview(line)
    }));

  return {
    ...(before.length === 0 ? {} : { before }),
    ...(after.length === 0 ? {} : { after })
  };
}

export function truncateSearchTextPreview(value: string): string {
  return value.length <= SEARCH_TEXT_PREVIEW_LIMIT
    ? value
    : `${value.slice(0, SEARCH_TEXT_PREVIEW_LIMIT)}...`;
}
