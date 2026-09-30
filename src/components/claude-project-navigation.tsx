"use client";

import { useEffect } from "react";
import type { Route } from "next";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { PublicAgentPanel, PublicClaudeProject } from "@/contracts/agents";
import { Navigation } from "@/components/navigation";

export function ClaudeProjectNavigation({
  panel,
  projects,
}: {
  panel: PublicAgentPanel;
  projects: readonly PublicClaudeProject[];
}) {
  const pathname = usePathname();
  const search = useSearchParams();
  const router = useRouter();
  const selected = search.get("project") ?? projects[0]?.id ?? "";
  useEffect(() => {
    if (search.has("project") || !selected) return;
    const url = new URL(window.location.href);
    url.searchParams.set("project", selected);
    window.history.replaceState(
      window.history.state,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
  }, [search, selected]);
  return (
    <>
      {projects.length === 1 ? (
        <div className="claude-project-picker">
          <span>Project</span>
          <strong>{projects[0]!.name}</strong>
        </div>
      ) : (
        <label className="claude-project-picker">
          Project
          <select
            value={selected}
            onChange={(event) =>
              router.push(`${pathname}?project=${encodeURIComponent(event.target.value)}` as Route)
            }
          >
            {!projects.some((project) => project.id === selected) ? (
              <option value={selected}>Unknown project</option>
            ) : null}
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <Navigation panel={panel} projectId={selected} />
    </>
  );
}
