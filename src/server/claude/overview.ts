import "server-only";
import { claudeOverviewSnapshotSchema } from "@/contracts/claude-overview";
import { resolveClaudeProject } from "@/server/claude/projects";
import { readClaudeSessionPage } from "@/server/claude/reader";
import { loadClaudeSystem } from "@/server/claude/system";
import type { ClaudePanelDescriptor } from "@/server/panels/registry";
import { assertSourceReadAllowed } from "@/server/security/prerender-guard";
import { loadWorkspaceDirectory } from "@/server/services/files";

export async function loadClaudeOverview(panel: ClaudePanelDescriptor, projectId?: string | null) {
  assertSourceReadAllowed();
  const project = resolveClaudeProject(panel, projectId);
  const [sessions, system, files] = await Promise.allSettled([
    readClaudeSessionPage(panel, null, project.id),
    loadClaudeSystem(panel, project.id),
    loadWorkspaceDirectory("", { workspaceRoot: project.workspaceRoot }),
  ]);
  const counts = { Instructions: 0, Memory: 0, Skills: 0, Subagents: 0 };
  if (system.status === "fulfilled")
    for (const source of system.value.sources) counts[source.category]++;
  return claudeOverviewSnapshotSchema.parse({
    project: { id: project.id, name: project.name },
    sessions: sessions.status === "fulfilled" ? sessions.value : null,
    system:
      system.status === "fulfilled"
        ? {
            counts,
            limited: system.value.limited,
            unavailable:
              system.value.unavailableScopes.length > 0 ||
              system.value.sources.some((source) => source.state === "unavailable"),
          }
        : null,
    files:
      files.status === "fulfilled"
        ? { entries: files.value.items.length, limited: files.value.truncated }
        : null,
    observedAt: new Date().toISOString(),
  });
}
