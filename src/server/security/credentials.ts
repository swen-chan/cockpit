import "server-only";

import { isCredentialFilename } from "@/lib/browser-safety";

export { isCredentialFilename };

export function isDotPathSegment(segment: string): boolean {
  return segment.startsWith(".");
}

export function hasExcludedSegment(segments: string[]): boolean {
  return segments.some((segment) => isDotPathSegment(segment) || isCredentialFilename(segment));
}
