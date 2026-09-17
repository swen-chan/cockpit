import "server-only";

import type { CodexPanelDescriptor } from "@/server/panels/registry";
import {
  cleanBrowserText,
  isWellFormedUnicode,
  type BrowserCleanedText,
} from "@/server/security/safe-text";

export { isWellFormedUnicode };

export type CodexCleanedText = BrowserCleanedText;

export function cleanCodexText(
  value: string,
  panel: CodexPanelDescriptor,
  operatorHome: string,
): CodexCleanedText {
  return cleanBrowserText(value, {
    literalPaths: [operatorHome, panel.configuration.home, panel.configuration.workspaceRoot],
  });
}
