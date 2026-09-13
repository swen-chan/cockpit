import "server-only";

import { homedir } from "node:os";
import path from "node:path";

import type { Conversation, ConversationPage } from "@/contracts/cockpit";
import { readConversationPage, readConversationTranscript } from "@/server/adapters/conversations";
import { resolveHermesContextFromEnvironment, type HermesContext } from "@/server/config/hermes-context";
import { readPrivateSourceManifest, type PrivateSourceManifest } from "@/server/config/source-manifest";
import { SourceSecurityError, toSafeDiagnostic, type SafeDiagnostic } from "@/server/security/errors";

export interface LoadConversationOptions {
  environment?: Readonly<Record<string, string | undefined>>;
  manifest?: PrivateSourceManifest;
  now?: Date;
  platformRoot?: string;
}

export interface ConversationPageData {
  initialConversation: Conversation | null;
  page: ConversationPage;
  failure?: SafeDiagnostic | undefined;
}

function resolveSource(options: LoadConversationOptions): {
  context: HermesContext;
  manifest: PrivateSourceManifest;
} {
  const environment = options.environment ?? process.env;
  const platformRoot = options.platformRoot
    ?? environment.COCKPIT_PLATFORM_HERMES_ROOT?.trim()
    ?? path.join(homedir(), ".hermes");
  const explicitHome = environment.COCKPIT_HERMES_HOME?.trim();
  const context = resolveHermesContextFromEnvironment({
    platformRoot,
    environment,
    ...(explicitHome ? { explicitHome } : {}),
  });
  if (options.manifest) return { context, manifest: options.manifest };
  const manifestPath = environment.COCKPIT_SOURCE_MANIFEST?.trim();
  if (!manifestPath) throw new SourceSecurityError("missing_source");
  return { context, manifest: readPrivateSourceManifest(manifestPath) };
}

export async function loadConversationPage(
  cursor: string | null = null,
  limit: number = 5,
  options: LoadConversationOptions = {},
): Promise<ConversationPage> {
  const source = resolveSource(options);
  return readConversationPage(
    source.context,
    source.manifest.conversation,
    cursor,
    limit,
    options.now ?? new Date(),
  );
}

export async function loadConversationTranscript(
  requestedId: string,
  options: LoadConversationOptions = {},
): Promise<Conversation> {
  const source = resolveSource(options);
  return readConversationTranscript(source.context, source.manifest.conversation, requestedId);
}

export async function loadConversationPageData(
  options: LoadConversationOptions = {},
): Promise<ConversationPageData> {
  const now = options.now ?? new Date();
  let page: ConversationPage;
  try {
    page = await loadConversationPage(null, 5, { ...options, now });
  } catch (error) {
    return {
      initialConversation: null,
      page: { items: [], nextCursor: null, observedAt: now.toISOString() },
      failure: toSafeDiagnostic(error, "conversation-store", now),
    };
  }
  const first = page.items[0];
  if (!first) return { initialConversation: null, page };
  try {
    return { initialConversation: await loadConversationTranscript(first.id, options), page };
  } catch (error) {
    return {
      initialConversation: null,
      page,
      failure: toSafeDiagnostic(error, "conversation-store", now),
    };
  }
}
