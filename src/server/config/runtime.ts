import "server-only";

import { canonicalizeDirectory } from "@/server/security/path-policy";
import { SourceSecurityError } from "@/server/security/errors";

export interface CockpitRuntimeConfig {
  workspaceRoot: string;
  explicitHermesHome?: string;
}

export function resolveCockpitRuntimeConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): CockpitRuntimeConfig {
  const configuredWorkspace = environment.COCKPIT_WORKSPACE_ROOT?.trim();
  if (!configuredWorkspace) throw new SourceSecurityError("missing_source");
  const workspaceRoot = canonicalizeDirectory(configuredWorkspace);
  const explicitHome = environment.COCKPIT_HERMES_HOME?.trim();
  return {
    workspaceRoot,
    ...(explicitHome ? { explicitHermesHome: canonicalizeDirectory(explicitHome) } : {}),
  };
}
