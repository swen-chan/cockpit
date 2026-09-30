import type { AgentSurface } from "@/contracts/agents";
import { panelSurfaceHref } from "@/lib/panel-navigation";

export function claudeHref(
  surface: AgentSurface,
  projectId: string,
  values: Record<string, string> = {},
): string {
  const query = new URLSearchParams({ project: projectId, ...values });
  return `${panelSurfaceHref("claude-code", surface)}?${query}`;
}

export function withClaudeProject(url: string, projectId?: string): string {
  return projectId
    ? `${url}${url.includes("?") ? "&" : "?"}project=${encodeURIComponent(projectId)}`
    : url;
}
