import "server-only";

import { closeSync, openSync, readSync } from "node:fs";
import path from "node:path";

import { canonicalizeDirectory } from "@/server/security/path-policy";
import { SourceSecurityError } from "@/server/security/errors";

export type HermesProfileKind = "default" | "named" | "custom";

export interface HermesContext {
  home: string;
  profile: string;
  profileKind: HermesProfileKind;
  source: "explicit" | "environment" | "sticky" | "platform-default";
}

export interface ResolveHermesContextOptions {
  platformRoot: string;
  explicitHome?: string;
  environmentHome?: string;
  stickyProfile?: string | null;
}

export interface ResolveHermesEnvironmentOptions extends Omit<
  ResolveHermesContextOptions,
  "environmentHome"
> {
  environment?: Readonly<Record<string, string | undefined>>;
}

const profileNamePattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u;
const maxStickyProfileBytes = 256;

function isFileSystemCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

function readStickyProfile(platformRoot: string): string | null {
  const canonicalPlatformRoot = canonicalizeDirectory(platformRoot);
  let descriptor: number;
  try {
    descriptor = openSync(path.join(canonicalPlatformRoot, "active_profile"), "r");
  } catch (error) {
    if (isFileSystemCode(error, "ENOENT")) return null;
    throw new SourceSecurityError("source_unavailable");
  }

  try {
    const buffer = Buffer.alloc(maxStickyProfileBytes + 1);
    const bytesRead = readSync(descriptor, buffer, 0, buffer.byteLength, 0);
    if (bytesRead > maxStickyProfileBytes) throw new SourceSecurityError("invalid_profile");
    const profile = buffer.subarray(0, bytesRead).toString("utf8").trim();
    return profile || null;
  } finally {
    closeSync(descriptor);
  }
}

function validateProfileName(profile: string): string {
  if (!profileNamePattern.test(profile)) throw new SourceSecurityError("invalid_profile");
  return profile;
}

function contextFromHome(
  home: string,
  platformRoot: string,
  source: HermesContext["source"],
): HermesContext {
  const canonicalHome = canonicalizeDirectory(home);
  let canonicalPlatformRoot: string;
  try {
    canonicalPlatformRoot = canonicalizeDirectory(platformRoot);
  } catch (error) {
    if (
      (source === "explicit" || source === "environment") &&
      error instanceof SourceSecurityError &&
      error.code === "missing_source"
    ) {
      return { home: canonicalHome, profile: "custom", profileKind: "custom", source };
    }
    throw error;
  }
  const profilesRoot = path.join(canonicalPlatformRoot, "profiles");

  if (canonicalHome === canonicalPlatformRoot) {
    return { home: canonicalHome, profile: "default", profileKind: "default", source };
  }
  if (
    canonicalHome.startsWith(`${profilesRoot}${path.sep}`) &&
    path.dirname(canonicalHome) === profilesRoot
  ) {
    return {
      home: canonicalHome,
      profile: validateProfileName(path.basename(canonicalHome)),
      profileKind: "named",
      source,
    };
  }
  return { home: canonicalHome, profile: "custom", profileKind: "custom", source };
}

export function resolveHermesContext(options: ResolveHermesContextOptions): HermesContext {
  if (options.explicitHome)
    return contextFromHome(options.explicitHome, options.platformRoot, "explicit");
  if (options.environmentHome)
    return contextFromHome(options.environmentHome, options.platformRoot, "environment");

  const stickyProfile = options.stickyProfile?.trim();
  if (!stickyProfile || stickyProfile === "default") {
    return contextFromHome(
      options.platformRoot,
      options.platformRoot,
      stickyProfile ? "sticky" : "platform-default",
    );
  }

  const profile = validateProfileName(stickyProfile);
  try {
    const context = contextFromHome(
      path.join(options.platformRoot, "profiles", profile),
      options.platformRoot,
      "sticky",
    );
    if (context.profileKind !== "named" || context.profile !== profile) {
      throw new SourceSecurityError("invalid_profile");
    }
    return context;
  } catch {
    throw new SourceSecurityError("invalid_profile");
  }
}

export function resolveHermesContextFromEnvironment(
  options: ResolveHermesEnvironmentOptions,
): HermesContext {
  const environment = options.environment ?? process.env;
  const environmentHome = environment.HERMES_HOME;
  if (options.explicitHome || environmentHome) {
    return resolveHermesContext({
      platformRoot: options.platformRoot,
      ...(options.explicitHome ? { explicitHome: options.explicitHome } : {}),
      ...(environmentHome ? { environmentHome } : {}),
    });
  }

  const stickyProfile =
    options.stickyProfile === undefined
      ? readStickyProfile(options.platformRoot)
      : options.stickyProfile;
  const base = {
    platformRoot: options.platformRoot,
    stickyProfile,
  };
  return resolveHermesContext(base);
}
