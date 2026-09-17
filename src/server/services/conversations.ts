import "server-only";

import { homedir } from "node:os";
import path from "node:path";

import type { Conversation, ConversationPage } from "@/contracts/cockpit";
import {
  readConversationPage,
  readConversationTranscript,
  type ConversationIdentityCodec,
} from "@/server/adapters/conversations";
import {
  resolveHermesContextFromEnvironment,
  type HermesContext,
} from "@/server/config/hermes-context";
import { resolveSourceManifest, type PrivateSourceManifest } from "@/server/config/source-manifest";
import { toSafeDiagnostic, type SafeDiagnostic } from "@/server/security/errors";
import { assertSourceReadAllowed } from "@/server/security/prerender-guard";

export interface LoadConversationOptions {
  environment?: Readonly<Record<string, string | undefined>>;
  identityCodec?: ConversationIdentityCodec;
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
  const platformRoot =
    options.platformRoot ??
    environment.COCKPIT_PLATFORM_HERMES_ROOT?.trim() ??
    path.join(homedir(), ".hermes");
  const explicitHome = environment.COCKPIT_HERMES_HOME?.trim();
  const context = resolveHermesContextFromEnvironment({
    platformRoot,
    environment,
    ...(explicitHome ? { explicitHome } : {}),
  });
  return { context, ...resolveSourceManifest(environment, options.manifest) };
}

export async function loadConversationPage(
  cursor: string | null = null,
  limit: number = 5,
  options: LoadConversationOptions = {},
): Promise<ConversationPage> {
  if (cursor !== null && options.identityCodec) {
    options.identityCodec.decodeCursor(cursor);
  }
  const source = resolveSource(options);
  return readConversationPage(
    source.context,
    source.manifest.conversation,
    cursor,
    limit,
    options.now ?? new Date(),
    options.identityCodec ? { identityCodec: options.identityCodec } : {},
  );
}

export async function loadConversationTranscript(
  requestedId: string,
  options: LoadConversationOptions = {},
): Promise<Conversation> {
  if (options.identityCodec) {
    options.identityCodec.decodeTask(requestedId);
  }
  const source = resolveSource(options);
  return readConversationTranscript(
    source.context,
    source.manifest.conversation,
    requestedId,
    options.identityCodec ? { identityCodec: options.identityCodec } : {},
  );
}

export async function loadConversationPageData(
  options: LoadConversationOptions = {},
): Promise<ConversationPageData> {
  assertSourceReadAllowed();
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
