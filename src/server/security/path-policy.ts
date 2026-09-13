import "server-only";

import { closeSync, constants, fstatSync, openSync, realpathSync, statSync } from "node:fs";
import path from "node:path";

import { hasExcludedSegment } from "@/server/security/credentials";
import { SourceSecurityError } from "@/server/security/errors";
import { SOURCE_LIMITS } from "@/server/security/limits";

const encodedDangerousPathPart = /%(?:00|2e|2f|5c)/iu;

export interface OpenWorkspaceFile {
  descriptor: number;
  relativePath: string;
  size: number;
}

export interface ExistingWorkspaceDirectory {
  absolutePath: string;
  relativePath: string;
}

function isContained(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

export function parseRelativePath(input: string): string[] {
  if (input.length > SOURCE_LIMITS.maxPathCharacters || input.includes("\0")) {
    throw new SourceSecurityError("invalid_path");
  }
  if (encodedDangerousPathPart.test(input)) throw new SourceSecurityError("invalid_path");

  let decoded: string;
  try {
    decoded = decodeURIComponent(input);
  } catch {
    throw new SourceSecurityError("invalid_path");
  }

  if (encodedDangerousPathPart.test(decoded) || decoded.includes("\0") || decoded.includes("\\") || path.posix.isAbsolute(decoded)) {
    throw new SourceSecurityError("invalid_path");
  }

  if (decoded === "") return [];
  const segments = decoded.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new SourceSecurityError("invalid_path");
  }
  if (hasExcludedSegment(segments)) throw new SourceSecurityError("excluded_path");
  return segments;
}

export function canonicalizeDirectory(directory: string): string {
  let canonical: string;
  try {
    canonical = realpathSync(directory);
    if (!statSync(canonical).isDirectory()) throw new SourceSecurityError("missing_source");
  } catch (error) {
    if (error instanceof SourceSecurityError) throw error;
    throw new SourceSecurityError("missing_source");
  }
  return canonical;
}

function assertAllowedCanonicalPath(canonicalRoot: string, absolutePath: string): void {
  if (!isContained(canonicalRoot, absolutePath)) throw new SourceSecurityError("path_outside_root");
  const canonicalRelativePath = path.relative(canonicalRoot, absolutePath);
  const canonicalSegments = canonicalRelativePath === "" ? [] : canonicalRelativePath.split(path.sep);
  if (hasExcludedSegment(canonicalSegments)) throw new SourceSecurityError("excluded_path");
}

export async function withExistingWorkspaceDirectory<T>(
  root: string,
  relativeInput: string,
  read: (directory: ExistingWorkspaceDirectory) => T | Promise<T>,
): Promise<T> {
  const canonicalRoot = canonicalizeDirectory(root);
  const segments = parseRelativePath(relativeInput);
  const candidate = path.resolve(canonicalRoot, ...segments);
  if (!isContained(canonicalRoot, candidate)) throw new SourceSecurityError("path_outside_root");

  let resolvedPath: string;
  try {
    resolvedPath = realpathSync(candidate);
    assertAllowedCanonicalPath(canonicalRoot, resolvedPath);
  } catch (error) {
    if (error instanceof SourceSecurityError) throw error;
    throw new SourceSecurityError("missing_source");
  }

  try {
    const opened = statSync(resolvedPath);
    if (!opened.isDirectory()) throw new SourceSecurityError("missing_source");
    const result = await read({ absolutePath: resolvedPath, relativePath: segments.join("/") });
    const currentPath = realpathSync(resolvedPath);
    assertAllowedCanonicalPath(canonicalRoot, currentPath);
    const current = statSync(currentPath);
    if (!current.isDirectory() || opened.dev !== current.dev || opened.ino !== current.ino) {
      throw new SourceSecurityError("source_unavailable");
    }
    return result;
  } catch (error) {
    if (error instanceof SourceSecurityError) throw error;
    throw new SourceSecurityError("source_unavailable");
  }
}

export async function withExistingWorkspaceFile<T>(
  root: string,
  relativeInput: string,
  read: (file: OpenWorkspaceFile) => T | Promise<T>,
): Promise<T> {
  const canonicalRoot = canonicalizeDirectory(root);
  const segments = parseRelativePath(relativeInput);
  const candidate = path.resolve(canonicalRoot, ...segments);
  if (!isContained(canonicalRoot, candidate)) throw new SourceSecurityError("path_outside_root");

  let resolvedPath: string;
  try {
    resolvedPath = realpathSync(candidate);
  } catch {
    throw new SourceSecurityError("missing_source");
  }
  assertAllowedCanonicalPath(canonicalRoot, resolvedPath);

  let descriptor: number;
  try {
    descriptor = openSync(resolvedPath, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    throw new SourceSecurityError("missing_source");
  }

  try {
    const opened = fstatSync(descriptor);
    if (!opened.isFile()) throw new SourceSecurityError("missing_source");

    const currentPath = realpathSync(resolvedPath);
    assertAllowedCanonicalPath(canonicalRoot, currentPath);
    const current = statSync(currentPath);
    if (opened.dev !== current.dev || opened.ino !== current.ino) {
      throw new SourceSecurityError("source_unavailable");
    }

    return await read({ descriptor, relativePath: segments.join("/"), size: opened.size });
  } catch (error) {
    if (error instanceof SourceSecurityError) throw error;
    throw new SourceSecurityError("source_unavailable");
  } finally {
    closeSync(descriptor);
  }
}
