import "server-only";

import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  realpathSync,
  statSync,
} from "node:fs";
import path from "node:path";

import { hasExcludedSegment } from "@/server/security/credentials";
import { SourceSecurityError } from "@/server/security/errors";
import { SOURCE_LIMITS } from "@/server/security/limits";

const encodedDangerousPathPart = /%(?:00|2e|2f|5c)/iu;
const protocolPathForbidden =
  /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u;

export type ApprovedWorkspacePathKind = "file" | "directory" | "any";

export interface ResolveApprovedWorkspacePathOptions {
  /** An absolute, existing directory used only to resolve a relative protocol path. */
  base?: string;
  kind: ApprovedWorkspacePathKind;
  allowMissing?: boolean;
}

export interface ApprovedWorkspacePath {
  /** Server-only canonical path. Never copy this field into a browser DTO. */
  absolutePath: string;
  /** Canonical POSIX path relative to the configured approved root. */
  relativePath: string;
}

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

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

interface ProtocolPath {
  absolute: boolean;
  segments: string[];
}

function parseProtocolPath(input: string): ProtocolPath {
  if (
    input.length === 0 ||
    input.length > SOURCE_LIMITS.maxPathCharacters ||
    !isWellFormedUnicode(input) ||
    protocolPathForbidden.test(input) ||
    input.includes("\\")
  ) {
    throw new SourceSecurityError("invalid_path");
  }

  let normalized = input;
  while (normalized.length > 1 && normalized.endsWith("/")) normalized = normalized.slice(0, -1);
  const absolute = path.posix.isAbsolute(normalized);
  const pathBody = absolute ? normalized.slice(1) : normalized;
  const segments = pathBody === "" ? [] : pathBody.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new SourceSecurityError("invalid_path");
  }
  if (!absolute && hasExcludedSegment(segments)) throw new SourceSecurityError("excluded_path");
  return { absolute, segments };
}

function canonicalRelativePath(canonicalRoot: string, absolutePath: string): string {
  const relativePath = path.relative(canonicalRoot, absolutePath).split(path.sep).join("/");
  if (relativePath.length > SOURCE_LIMITS.maxPathCharacters) {
    throw new SourceSecurityError("invalid_path");
  }
  return relativePath;
}

function matchingKind(
  stats: ReturnType<typeof fstatSync>,
  kind: ApprovedWorkspacePathKind,
): boolean {
  if (kind === "file") return stats.isFile();
  if (kind === "directory") return stats.isDirectory();
  return stats.isFile() || stats.isDirectory();
}

function assertMatchingKind(
  stats: ReturnType<typeof fstatSync>,
  kind: ApprovedWorkspacePathKind,
): void {
  if (matchingKind(stats, kind)) return;
  // A regular file/directory of the wrong requested kind behaves like a
  // missing source. Special files are unavailable: they must never be opened
  // through a read path that could block the server process.
  if (stats.isFile() || stats.isDirectory()) throw new SourceSecurityError("missing_source");
  throw new SourceSecurityError("source_unavailable");
}

function preflightOpenKind(
  resolvedPath: string,
  kind: ApprovedWorkspacePathKind,
): ReturnType<typeof fstatSync> {
  try {
    const stats = lstatSync(resolvedPath);
    assertMatchingKind(stats, kind);
    return stats;
  } catch (error) {
    if (error instanceof SourceSecurityError) throw error;
    throw filesystemSourceError(error);
  }
}

function resolveExistingAbsolutePath(
  canonicalRoot: string,
  candidate: string,
  kind: ApprovedWorkspacePathKind,
): ApprovedWorkspacePath {
  let resolvedPath: string;
  try {
    resolvedPath = realpathSync(candidate);
  } catch (error) {
    throw filesystemSourceError(error);
  }
  assertAllowedCanonicalPath(canonicalRoot, resolvedPath);
  const preopened = preflightOpenKind(resolvedPath, kind);

  let descriptor: number;
  try {
    descriptor = openSync(
      resolvedPath,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
  } catch (error) {
    throw filesystemSourceError(error);
  }

  try {
    const opened = fstatSync(descriptor);
    if (
      !matchingKind(opened, kind) ||
      preopened.dev !== opened.dev ||
      preopened.ino !== opened.ino
    ) {
      throw new SourceSecurityError("source_unavailable");
    }

    const currentPath = realpathSync(resolvedPath);
    assertAllowedCanonicalPath(canonicalRoot, currentPath);
    const current = statSync(currentPath);
    if (!matchingKind(current, kind) || opened.dev !== current.dev || opened.ino !== current.ino) {
      throw new SourceSecurityError("source_unavailable");
    }
    return {
      absolutePath: currentPath,
      relativePath: canonicalRelativePath(canonicalRoot, currentPath),
    };
  } catch (error) {
    if (error instanceof SourceSecurityError) throw error;
    throw new SourceSecurityError("source_unavailable");
  } finally {
    closeSync(descriptor);
  }
}

function isMissingPath(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTDIR")
  );
}

function filesystemSourceError(error: unknown): SourceSecurityError {
  return new SourceSecurityError(isMissingPath(error) ? "missing_source" : "source_unavailable");
}

function existingPath(candidate: string): boolean {
  try {
    lstatSync(candidate);
    return true;
  } catch (error) {
    if (isMissingPath(error)) return false;
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOTDIR"
    ) {
      throw new SourceSecurityError("missing_source");
    }
    throw new SourceSecurityError("source_unavailable");
  }
}

function resolveMissingAbsolutePath(
  canonicalRoot: string,
  candidate: string,
): ApprovedWorkspacePath {
  let ancestor = path.dirname(candidate);
  const suffix = [path.basename(candidate)];

  while (!existingPath(ancestor)) {
    const parent = path.dirname(ancestor);
    if (parent === ancestor) throw new SourceSecurityError("path_outside_root");
    suffix.unshift(path.basename(ancestor));
    ancestor = parent;
  }

  const provenAncestor = resolveExistingAbsolutePath(canonicalRoot, ancestor, "directory");
  const resolvedPath = path.resolve(provenAncestor.absolutePath, ...suffix);
  assertAllowedCanonicalPath(canonicalRoot, resolvedPath);
  return {
    absolutePath: resolvedPath,
    relativePath: canonicalRelativePath(canonicalRoot, resolvedPath),
  };
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

  if (
    encodedDangerousPathPart.test(decoded) ||
    decoded.includes("\0") ||
    decoded.includes("\\") ||
    path.posix.isAbsolute(decoded)
  ) {
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
    throw filesystemSourceError(error);
  }
  return canonical;
}

function assertAllowedCanonicalPath(canonicalRoot: string, absolutePath: string): void {
  if (!isContained(canonicalRoot, absolutePath)) throw new SourceSecurityError("path_outside_root");
  const canonicalRelativePath = path.relative(canonicalRoot, absolutePath);
  if (
    !isWellFormedUnicode(canonicalRelativePath) ||
    protocolPathForbidden.test(canonicalRelativePath) ||
    canonicalRelativePath.includes("\\") ||
    canonicalRelativePath.length > SOURCE_LIMITS.maxPathCharacters
  ) {
    throw new SourceSecurityError("invalid_path");
  }
  const canonicalSegments =
    canonicalRelativePath === "" ? [] : canonicalRelativePath.split(path.sep);
  if (hasExcludedSegment(canonicalSegments)) throw new SourceSecurityError("excluded_path");
}

/**
 * Prove a protocol-derived path against one server-configured workspace root.
 *
 * Unlike parseRelativePath, this function consumes filesystem path text rather
 * than URL input, so percent-encoded-looking names remain literal. Relative
 * candidates require an independently proven existing directory base. Missing
 * candidates are accepted only when explicitly requested and only after their
 * nearest existing directory ancestor has passed the same canonical policy.
 */
export function resolveApprovedWorkspacePath(
  root: string,
  candidate: string,
  options: ResolveApprovedWorkspacePathOptions,
): ApprovedWorkspacePath {
  const canonicalRoot = canonicalizeDirectory(root);
  const absoluteCandidate = resolveProtocolCandidate(canonicalRoot, candidate, options.base);

  if (existingPath(absoluteCandidate)) {
    return resolveExistingAbsolutePath(canonicalRoot, absoluteCandidate, options.kind);
  }
  if (!options.allowMissing) throw new SourceSecurityError("missing_source");
  return resolveMissingAbsolutePath(canonicalRoot, absoluteCandidate);
}

function resolveProtocolCandidate(
  canonicalRoot: string,
  candidate: string,
  base: string | undefined,
): string {
  const parsedCandidate = parseProtocolPath(candidate);

  let absoluteCandidate: string;
  if (parsedCandidate.absolute) {
    absoluteCandidate = path.resolve(path.sep, ...parsedCandidate.segments);
  } else {
    if (base === undefined) throw new SourceSecurityError("invalid_path");
    const parsedBase = parseProtocolPath(base);
    if (!parsedBase.absolute) throw new SourceSecurityError("invalid_path");
    const baseCandidate = path.resolve(path.sep, ...parsedBase.segments);
    const provenBase = resolveExistingAbsolutePath(canonicalRoot, baseCandidate, "directory");
    absoluteCandidate = path.resolve(provenBase.absolutePath, ...parsedCandidate.segments);
  }

  if (!isContained(canonicalRoot, absoluteCandidate) && !parsedCandidate.absolute) {
    throw new SourceSecurityError("path_outside_root");
  }
  return absoluteCandidate;
}

/**
 * Resolve a private canonical identity for deduplication only. This does not
 * prove the target kind or authorize reading it; callers must still use the
 * descriptor-backed resolver before consuming source content.
 */
export function resolveApprovedWorkspacePathIdentity(
  root: string,
  candidate: string,
  base?: string,
): string {
  const canonicalRoot = canonicalizeDirectory(root);
  const absoluteCandidate = resolveProtocolCandidate(canonicalRoot, candidate, base);
  let identity: string;
  try {
    identity = realpathSync(absoluteCandidate);
  } catch (error) {
    throw filesystemSourceError(error);
  }
  assertAllowedCanonicalPath(canonicalRoot, identity);
  return identity;
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
    throw filesystemSourceError(error);
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
  } catch (error) {
    throw filesystemSourceError(error);
  }
  assertAllowedCanonicalPath(canonicalRoot, resolvedPath);
  const preopened = preflightOpenKind(resolvedPath, "file");

  let descriptor: number;
  try {
    descriptor = openSync(
      resolvedPath,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
  } catch (error) {
    throw filesystemSourceError(error);
  }

  try {
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || preopened.dev !== opened.dev || preopened.ino !== opened.ino) {
      throw new SourceSecurityError("source_unavailable");
    }

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
