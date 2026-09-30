import { describe, expect, it } from "vitest";

import { publicClaudeProjectSchema } from "@/contracts/agents";
import { resolveClaudeProject } from "@/server/claude/projects";
import {
  resolvePanel,
  resolvePanelRegistry,
  type ClaudePanelDescriptor,
} from "@/server/panels/registry";

const project = {
  id: "website",
  name: "Website 网站",
  sessionRoot: "/synthetic/claude/website-sessions",
  workspaceRoot: "/synthetic/workspaces/website",
};
const secondProject = {
  id: "notes",
  name: "Notes",
  sessionRoot: "/synthetic/claude/notes-sessions",
  workspaceRoot: "/synthetic/workspaces/notes",
  memoryRoot: "/synthetic/claude/notes-memory",
};

function configuration(projects: unknown) {
  return { COCKPIT_CLAUDE_PROJECTS: JSON.stringify(projects) };
}

function panel(): ClaudePanelDescriptor {
  const result = resolvePanel(
    resolvePanelRegistry(configuration([project, secondProject])),
    "claude-code",
  );
  if (result.runtime !== "claude-code") throw new Error("Expected Claude panel.");
  return result;
}

describe("explicit Claude project scope", () => {
  it("preserves approved roots server-side and resolves the first or exact project", () => {
    const claude = panel();
    expect(claude.configuration.projects).toEqual([project, secondProject]);
    expect(resolveClaudeProject(claude)).toEqual(project);
    expect(resolveClaudeProject(claude, null)).toEqual(project);
    expect(resolveClaudeProject(claude, "notes")).toEqual(secondProject);
    expect(Object.isFrozen(claude.configuration)).toBe(true);
    expect(Object.isFrozen(claude.configuration.projects)).toBe(true);
    expect(Object.isFrozen(claude.configuration.projects[0])).toBe(true);
  });

  it.each(["", "unknown", "../notes", "/synthetic/workspaces/website", "WEBSITE"])(
    "rejects an unknown project without substituting another project: %s",
    (id) => {
      expect(() => resolveClaudeProject(panel(), id)).toThrowError(
        expect.objectContaining({ code: "invalid_path" }),
      );
    },
  );

  it("accepts formatted JSON and optional user sources only with projects", () => {
    const registry = resolvePanelRegistry({
      COCKPIT_CLAUDE_PROJECTS: JSON.stringify([project], null, 2),
      COCKPIT_CLAUDE_USER_ROOT: "/synthetic/claude-user",
    });
    expect(registry.state).toBe("ready");
    expect(resolvePanel(registry, "claude-code").configuration).toEqual({
      projects: [project],
      userRoot: "/synthetic/claude-user",
    });
    expect(
      resolvePanelRegistry({ COCKPIT_CLAUDE_USER_ROOT: "/synthetic/claude-user" }),
    ).toMatchObject({
      state: "invalid",
      key: "COCKPIT_CLAUDE_PROJECTS",
    });
  });

  it("exposes only project id and name through the dedicated public schema", () => {
    expect(publicClaudeProjectSchema.parse({ id: project.id, name: project.name })).toEqual({
      id: project.id,
      name: project.name,
    });
    expect(publicClaudeProjectSchema.safeParse(project).success).toBe(false);
    const registry = resolvePanelRegistry(configuration([project]));
    if (registry.state !== "ready") throw new Error("Expected configured registry.");
    const publicJSON = JSON.stringify(registry.publicPanels);
    expect(publicJSON).not.toContain(project.sessionRoot);
    expect(publicJSON).not.toContain(project.workspaceRoot);
    expect(publicJSON).not.toContain("projects");
  });

  it.each([
    null,
    {},
    [],
    [project, project],
    [{ ...project, id: "../website" }],
    [{ ...project, id: "sk-abcdefghijklmnopqrstuvwx" }],
    [{ ...project, id: "a".repeat(41) }],
    [{ ...project, name: "" }],
    [{ ...project, name: "a".repeat(81) }],
    [{ ...project, name: "Website\nsecond line" }],
    [{ ...project, name: "Website\u202ereversed" }],
    [{ ...project, name: "Website\ud800" }],
    [{ ...project, name: "api_key=PRIVATE_MARKER" }],
    [{ ...project, name: "/Users/synthetic/private" }],
    [{ ...project, name: " padded " }],
    [{ ...project, extra: "unapproved" }],
    [{ ...project, workspaceRoot: undefined }],
    Array.from({ length: 13 }, (_, index) => ({ ...project, id: `project-${index}` })),
  ])("rejects malformed, unsafe, or ambiguous projects %#", (projects) => {
    const result = resolvePanelRegistry(configuration(projects));
    expect(result).toMatchObject({ state: "invalid", key: "COCKPIT_CLAUDE_PROJECTS" });
    expect(JSON.stringify(result)).not.toContain("PRIVATE_MARKER");
    expect(JSON.stringify(result)).not.toContain(project.sessionRoot);
  });

  it.each(["sessionRoot", "workspaceRoot", "memoryRoot"])(
    "requires an explicit bounded absolute %s other than the filesystem root",
    (key) => {
      for (const root of [
        "",
        "/",
        "/nested/..",
        "relative/root",
        " /synthetic/root",
        "/synthetic/root\n",
        "/" + "a".repeat(4096),
      ]) {
        expect(resolvePanelRegistry(configuration([{ ...project, [key]: root }]))).toMatchObject({
          state: "invalid",
          key: "COCKPIT_CLAUDE_PROJECTS",
        });
      }
    },
  );

  it.each(["/", "relative/root", " /synthetic/root", "/synthetic/root\n", "/synthetic/\ud800"])(
    "rejects an invalid shared user root %#",
    (root) => {
      expect(
        resolvePanelRegistry({ ...configuration([project]), COCKPIT_CLAUDE_USER_ROOT: root }),
      ).toMatchObject({
        state: "invalid",
        key: "COCKPIT_CLAUDE_USER_ROOT",
      });
    },
  );

  it("bounds JSON by bytes before parsing and never echoes malformed JSON", () => {
    for (const json of ["{ PRIVATE_CONFIGURATION_MARKER", "中".repeat(70 * 1024)]) {
      const result = resolvePanelRegistry({ COCKPIT_CLAUDE_PROJECTS: json });
      expect(result).toMatchObject({ state: "invalid", key: "COCKPIT_CLAUDE_PROJECTS" });
      expect(JSON.stringify(result)).not.toContain("PRIVATE_CONFIGURATION_MARKER");
      expect(JSON.stringify(result).length).toBeLessThan(400);
    }
  });

  it("rejects the retired session-only key even when new projects are supplied", () => {
    const result = resolvePanelRegistry({
      ...configuration([project]),
      COCKPIT_CLAUDE_SESSION_ROOT: "/synthetic/retired-private-root",
    });
    expect(result).toMatchObject({
      state: "invalid",
      key: "COCKPIT_CLAUDE_SESSION_ROOT",
      requirement:
        "Remove COCKPIT_CLAUDE_SESSION_ROOT and configure COCKPIT_CLAUDE_PROJECTS instead.",
    });
    expect(JSON.stringify(result)).not.toContain("retired-private-root");
  });
});
