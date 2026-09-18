import "server-only";

export const SOURCE_LIMITS = Object.freeze({
  maxPathCharacters: 1_024,
  maxPreviewBytes: 256 * 1_024,
  maxPreviewCharacters: 100_000,
  maxDirectoryEntries: 500,
  maxDirectoryScanEntries: 5_000,
  maxCollectionRecords: 1_000,
  maxJobDefinitionBytes: 1024 * 1_024,
  maxJobs: 250,
  maxExecutionsPerJob: 10,
});

export interface BoundedText {
  text: string;
  truncated: boolean;
  originalBytes: number;
}

export function boundUtf8Text(
  value: string,
  maxBytes: number = SOURCE_LIMITS.maxPreviewBytes,
  maxCharacters: number = SOURCE_LIMITS.maxPreviewCharacters,
): BoundedText {
  const encoded = Buffer.from(value, "utf8");
  const byteBounded =
    encoded.byteLength > maxBytes
      ? encoded
          .subarray(0, maxBytes)
          .toString("utf8")
          .replace(/\uFFFD$/u, "")
      : value;
  const characters = Array.from(byteBounded);
  const text =
    characters.length > maxCharacters ? characters.slice(0, maxCharacters).join("") : byteBounded;

  return {
    text,
    truncated: encoded.byteLength > maxBytes || characters.length > maxCharacters,
    originalBytes: encoded.byteLength,
  };
}
