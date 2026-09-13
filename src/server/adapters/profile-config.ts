import "server-only";

import { parse } from "yaml";

import type { ProfileSummary } from "@/contracts/cockpit";
import type { HermesContext } from "@/server/config/hermes-context";
import { asRecord, safeIdentifier } from "@/server/adapters/safe-values";
import { classifySourceError, SourceSecurityError } from "@/server/security/errors";
import { readNamedTextSource } from "@/server/files/bounded-text";

function extractModelAndProvider(config: unknown): Pick<ProfileSummary, "model" | "provider"> {
  const root = asRecord(config);
  if (!root) throw new SourceSecurityError("source_malformed");

  const modelSection = asRecord(root.model);
  const rawModel = modelSection?.default ?? modelSection?.model ?? modelSection?.name ?? root.model;
  const nestedModel = asRecord(rawModel);
  const model = safeIdentifier(
    nestedModel?.model ?? nestedModel?.default ?? rawModel,
    200,
  );
  const provider = safeIdentifier(
    modelSection?.provider ?? nestedModel?.provider ?? root.provider,
    100,
  );
  return { model, provider };
}

export async function readProfileSummary(
  context: HermesContext,
  configRelativePath: string,
): Promise<ProfileSummary> {
  const base: Omit<ProfileSummary, "configState" | "model" | "provider"> = {
    profile: context.profile,
    profileKind: context.profileKind,
    homeLabel: context.home,
    resolutionSource: context.source,
  };

  try {
    const source = await readNamedTextSource(context.home, configRelativePath, { rejectOversized: true });
    let parsed: unknown;
    try {
      parsed = parse(source.text, { maxAliasCount: 20, uniqueKeys: true });
    } catch {
      throw new SourceSecurityError("source_malformed");
    }
    const identifiers = extractModelAndProvider(parsed);
    return {
      ...base,
      configState: "ready",
      ...identifiers,
      modifiedAt: source.modifiedAt,
    };
  } catch (error) {
    const code = classifySourceError(error);
    return {
      ...base,
      configState: code === "missing_source" ? "unavailable" : "error",
      model: null,
      provider: null,
    };
  }
}

export function profileSummaryWithoutConfig(
  context: HermesContext,
  configState: "unavailable" | "error" = "unavailable",
): ProfileSummary {
  return {
    profile: context.profile,
    profileKind: context.profileKind,
    homeLabel: context.home,
    resolutionSource: context.source,
    configState,
    model: null,
    provider: null,
  };
}

export function unavailableProfileSummary(): ProfileSummary {
  return {
    profile: "Unavailable",
    profileKind: "unavailable",
    homeLabel: "<Hermes home unavailable>",
    resolutionSource: "unavailable",
    configState: "unavailable",
    model: null,
    provider: null,
  };
}
