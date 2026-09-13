import type { ReactNode } from "react";

export function countMatches(text: string, query: string): number {
  const cleanQuery = query.trim();
  if (!cleanQuery) return 0;

  return text.toLocaleLowerCase().split(cleanQuery.toLocaleLowerCase()).length - 1;
}

export function HighlightedText({ query, text }: { query: string; text: string }): ReactNode {
  const cleanQuery = query.trim();
  if (!cleanQuery) return text;

  const lowerText = text.toLocaleLowerCase();
  const lowerQuery = cleanQuery.toLocaleLowerCase();
  const parts: ReactNode[] = [];
  let cursor = 0;
  let matchIndex = lowerText.indexOf(lowerQuery);

  while (matchIndex !== -1) {
    parts.push(text.slice(cursor, matchIndex));
    parts.push(<mark key={`${matchIndex}-${cleanQuery}`}>{text.slice(matchIndex, matchIndex + cleanQuery.length)}</mark>);
    cursor = matchIndex + cleanQuery.length;
    matchIndex = lowerText.indexOf(lowerQuery, cursor);
  }

  parts.push(text.slice(cursor));
  return parts;
}
