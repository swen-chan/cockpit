import "server-only";

import { fstatSync, readSync } from "node:fs";

import { boundUtf8Text, SOURCE_LIMITS, type BoundedText } from "@/server/security/limits";
import { withExistingWorkspaceFile } from "@/server/security/path-policy";
import { SourceSecurityError } from "@/server/security/errors";

export interface NamedTextSource extends BoundedText {
  modifiedAt: string;
  relativePath: string;
}

export interface ReadNamedTextOptions {
  maxBytes?: number;
  maxCharacters?: number;
  rejectOversized?: boolean;
}

export async function readNamedTextSource(
  root: string,
  relativePath: string,
  options: ReadNamedTextOptions = {},
): Promise<NamedTextSource> {
  const maxBytes = options.maxBytes ?? SOURCE_LIMITS.maxPreviewBytes;
  const maxCharacters = options.maxCharacters ?? SOURCE_LIMITS.maxPreviewCharacters;

  return withExistingWorkspaceFile(root, relativePath, (file) => {
    if (options.rejectOversized && file.size > maxBytes) {
      throw new SourceSecurityError("source_too_large");
    }

    const bytesToRead = Math.min(file.size, maxBytes);
    const buffer = Buffer.alloc(bytesToRead);
    let offset = 0;
    while (offset < bytesToRead) {
      const bytesRead = readSync(file.descriptor, buffer, offset, bytesToRead - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }

    const bounded = boundUtf8Text(buffer.subarray(0, offset).toString("utf8"), maxBytes, maxCharacters);
    const stat = fstatSync(file.descriptor);
    return {
      ...bounded,
      originalBytes: file.size,
      truncated: file.size > maxBytes || bounded.truncated,
      modifiedAt: stat.mtime.toISOString(),
      relativePath: file.relativePath,
    };
  });
}
