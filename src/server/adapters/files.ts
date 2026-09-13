import "server-only";

import {
  fstatSync,
  lstatSync,
  opendirSync,
  readSync,
  realpathSync,
  statSync,
  type Dirent,
  type Stats,
} from "node:fs";
import path from "node:path";

import type { WorkspaceDirectory, WorkspaceFile } from "@/contracts/cockpit";
import { formatByteCount } from "@/server/adapters/safe-values";
import { hasExcludedSegment } from "@/server/security/credentials";
import { SOURCE_LIMITS, boundUtf8Text } from "@/server/security/limits";
import {
  canonicalizeDirectory,
  withExistingWorkspaceDirectory,
  withExistingWorkspaceFile,
} from "@/server/security/path-policy";
import { redactBrowserText } from "@/server/security/redaction";

const supportedTextExtensions = new Set([
  ".c",
  ".cc",
  ".conf",
  ".cpp",
  ".css",
  ".csv",
  ".go",
  ".h",
  ".html",
  ".ini",
  ".java",
  ".js",
  ".json",
  ".jsx",
  ".log",
  ".md",
  ".mjs",
  ".py",
  ".rb",
  ".rs",
  ".scss",
  ".sh",
  ".sql",
  ".toml",
  ".ts",
  ".tsv",
  ".tsx",
  ".txt",
  ".xml",
  ".yaml",
  ".yml",
]);

const supportedTextNames = new Set(["dockerfile", "license", "makefile", "readme"]);
const invalidVisibleName = /[\u0000-\u001F\u007F]/u;

function isContained(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

function allowedTextFile(filename: string): boolean {
  const normalized = filename.normalize("NFKC").toLocaleLowerCase("en-US");
  return supportedTextExtensions.has(path.extname(normalized)) || supportedTextNames.has(normalized);
}

function detectedKind(filename: string, entryType: "directory" | "file"): string {
  if (entryType === "directory") return "Directory";
  const extension = path.extname(filename).toLocaleLowerCase("en-US");
  if (extension === ".md") return "Markdown";
  if (extension === ".html" || extension === ".htm") return "HTML source";
  if (extension === ".json") return "JSON";
  if (extension === ".yaml" || extension === ".yml") return "YAML";
  if (extension === ".csv") return "CSV";
  if (extension === ".tsv") return "TSV";
  if (extension === ".pdf") return "PDF document";
  if ([".gif", ".jpeg", ".jpg", ".png", ".webp"].includes(extension)) return "Image";
  if (allowedTextFile(filename)) return "Text";
  return "Unsupported file";
}

function safeResolvedEntry(
  canonicalRoot: string,
  directoryPath: string,
  dirent: Dirent,
): { entryType: "directory" | "file"; stats: Stats } | null {
  if (dirent.name.length > 500 || invalidVisibleName.test(dirent.name) || hasExcludedSegment([dirent.name])) {
    return null;
  }
  const candidate = path.join(directoryPath, dirent.name);
  try {
    lstatSync(candidate);
    const resolved = realpathSync(candidate);
    if (!isContained(canonicalRoot, resolved)) return null;
    const relative = path.relative(canonicalRoot, resolved);
    if (hasExcludedSegment(relative === "" ? [] : relative.split(path.sep))) return null;
    const stats = statSync(resolved);
    if (stats.isDirectory()) return { entryType: "directory", stats };
    if (stats.isFile()) return { entryType: "file", stats };
    return null;
  } catch {
    return null;
  }
}

function workspaceEntry(
  canonicalRoot: string,
  directoryPath: string,
  relativeDirectory: string,
  dirent: Dirent,
): WorkspaceFile | null {
  const resolved = safeResolvedEntry(canonicalRoot, directoryPath, dirent);
  if (!resolved) return null;
  const relativePath = relativeDirectory ? `${relativeDirectory}/${dirent.name}` : dirent.name;
  if (relativePath.length > SOURCE_LIMITS.maxPathCharacters) return null;
  const kind = detectedKind(dirent.name, resolved.entryType);
  const previewState = resolved.entryType === "file"
    && allowedTextFile(dirent.name)
    && resolved.stats.size <= SOURCE_LIMITS.maxPreviewBytes
    ? "available"
    : resolved.entryType === "file" ? "metadata-only" : "unavailable";
  return {
    id: relativePath,
    name: dirent.name,
    path: relativePath,
    entryType: resolved.entryType,
    kind,
    size: resolved.entryType === "file" ? formatByteCount(resolved.stats.size) : "—",
    sizeBytes: resolved.entryType === "file" ? resolved.stats.size : null,
    modifiedAt: resolved.stats.mtime.toISOString(),
    previewState,
  };
}

function isBinary(buffer: Buffer): boolean {
  if (buffer.includes(0)) return true;
  const decoded = buffer.toString("utf8");
  if (decoded.includes("\uFFFD")) return true;
  let controlCharacters = 0;
  for (const character of decoded) {
    const code = character.codePointAt(0) ?? 0;
    if ((code < 32 && character !== "\n" && character !== "\r" && character !== "\t" && character !== "\f") || code === 127) {
      controlCharacters += 1;
    }
  }
  return decoded.length > 0 && controlCharacters / decoded.length > 0.01;
}

export async function readWorkspaceDirectory(
  root: string,
  relativePath: string = "",
  now: Date = new Date(),
): Promise<WorkspaceDirectory> {
  const canonicalRoot = canonicalizeDirectory(root);
  return withExistingWorkspaceDirectory(canonicalRoot, relativePath, (directory) => {
    const handle = opendirSync(directory.absolutePath);
    const candidates: Dirent[] = [];
    let scanned = 0;
    let reachedEnd = false;
    try {
      while (scanned < SOURCE_LIMITS.maxDirectoryScanEntries) {
        const entry = handle.readSync();
        if (!entry) {
          reachedEnd = true;
          break;
        }
        scanned += 1;
        if (!hasExcludedSegment([entry.name])) candidates.push(entry);
      }
    } finally {
      handle.closeSync();
    }

    candidates.sort((left, right) => left.name.localeCompare(right.name, "en", { numeric: true }));
    const safeEntries: WorkspaceFile[] = [];
    for (const candidate of candidates) {
      const entry = workspaceEntry(canonicalRoot, directory.absolutePath, directory.relativePath, candidate);
      if (entry) safeEntries.push(entry);
    }
    const truncated = !reachedEnd || safeEntries.length > SOURCE_LIMITS.maxDirectoryEntries;
    const parentPath = directory.relativePath === ""
      ? null
      : directory.relativePath.split("/").slice(0, -1).join("/");
    return {
      path: directory.relativePath,
      parentPath,
      items: safeEntries.slice(0, SOURCE_LIMITS.maxDirectoryEntries),
      observedAt: now.toISOString(),
      truncated,
    };
  });
}

export async function readWorkspacePreview(root: string, relativePath: string): Promise<WorkspaceFile> {
  return withExistingWorkspaceFile(root, relativePath, (file) => {
    const stats = fstatSync(file.descriptor);
    const name = path.posix.basename(file.relativePath);
    const base = {
      id: file.relativePath,
      name,
      path: file.relativePath,
      entryType: "file" as const,
      kind: detectedKind(name, "file"),
      size: formatByteCount(file.size),
      sizeBytes: file.size,
      modifiedAt: stats.mtime.toISOString(),
    };
    if (!allowedTextFile(name) || file.size > SOURCE_LIMITS.maxPreviewBytes) {
      return { ...base, previewState: "metadata-only" as const };
    }

    const buffer = Buffer.alloc(file.size);
    let offset = 0;
    while (offset < buffer.length) {
      const bytesRead = readSync(file.descriptor, buffer, offset, buffer.length - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    const contentBuffer = buffer.subarray(0, offset);
    if (isBinary(contentBuffer)) return { ...base, previewState: "metadata-only" as const };
    const redacted = redactBrowserText(contentBuffer.toString("utf8"));
    const bounded = boundUtf8Text(redacted, SOURCE_LIMITS.maxPreviewBytes, SOURCE_LIMITS.maxPreviewCharacters);
    return {
      ...base,
      previewState: "available" as const,
      content: bounded.text,
      ...(bounded.truncated ? { truncated: true } : {}),
    };
  });
}
