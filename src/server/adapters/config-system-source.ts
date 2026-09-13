import "server-only";

import type { ProfileSummary, SystemSource } from "@/contracts/cockpit";

export function profileConfigSystemSource(
  profile: ProfileSummary,
  now: Date = new Date(),
): SystemSource {
  const model = profile.model ?? "Not configured";
  const provider = profile.provider ?? "Not configured";
  const content = [
    "Resolved profile",
    profile.profile,
    "",
    "Hermes home",
    profile.homeLabel,
    "",
    "Active provider",
    provider,
    "",
    "Active model",
    model,
    "",
    "Credentials, endpoints, headers, environment references, and authentication state are omitted.",
  ].join("\n");

  return {
    id: "providers",
    title: "Providers",
    category: "Model routing",
    summary: "Safe profile, model, and provider identifiers from the resolved Hermes configuration.",
    content,
    stamp: {
      id: "safe-config",
      label: "Hermes configuration",
      path: "<HERMES_HOME> / <SAFE_CONFIG_SOURCE>",
      observedAt: now.toISOString(),
      state: profile.configState,
    },
    metadata: [
      { label: "Profile", value: profile.profile, mono: true },
      { label: "Home", value: profile.homeLabel, mono: true },
      { label: "Provider", value: provider, mono: true },
      { label: "Model", value: model, mono: true },
      { label: "Credentials", value: "Not read" },
      ...(profile.modifiedAt ? [{ label: "Modified", value: profile.modifiedAt, mono: true }] : []),
    ],
  };
}
