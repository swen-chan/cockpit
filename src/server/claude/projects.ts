import "server-only";

import type { ClaudePanelDescriptor, ClaudeProjectDescriptor } from "@/server/panels/registry";
import { SourceSecurityError } from "@/server/security/errors";

export function resolveClaudeProject(
  panel: ClaudePanelDescriptor,
  projectId?: string | null,
): ClaudeProjectDescriptor {
  const project =
    projectId == null
      ? panel.configuration.projects[0]
      : panel.configuration.projects.find(({ id }) => id === projectId);
  if (!project) throw new SourceSecurityError("invalid_path");
  return project;
}
