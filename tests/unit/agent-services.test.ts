import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  codexOverview: vi.fn(),
  codexSystem: vi.fn(),
  codexTaskDetail: vi.fn(),
  codexTaskPage: vi.fn(),
  conversationPage: vi.fn(),
  conversationTranscript: vi.fn(),
  filesDirectory: vi.fn(),
  filesPreview: vi.fn(),
  jobs: vi.fn(),
  overview: vi.fn(),
  profile: vi.fn(),
  skill: vi.fn(),
  system: vi.fn(),
  systemSources: vi.fn(),
}));

vi.mock("@/server/services/codex-overview", () => ({
  loadCodexOverviewSnapshot: mocks.codexOverview,
}));
vi.mock("@/server/services/codex-system", () => ({
  loadCodexSystemSnapshot: mocks.codexSystem,
}));
vi.mock("@/server/services/codex-tasks", () => ({
  loadCodexTaskDetail: mocks.codexTaskDetail,
  loadCodexTaskPage: mocks.codexTaskPage,
}));
vi.mock("@/server/services/conversations", () => ({
  loadConversationPage: mocks.conversationPage,
  loadConversationTranscript: mocks.conversationTranscript,
}));
vi.mock("@/server/services/files", () => ({
  loadWorkspaceDirectory: mocks.filesDirectory,
  loadWorkspacePreview: mocks.filesPreview,
}));
vi.mock("@/server/services/jobs", () => ({ loadJobsSnapshot: mocks.jobs }));
vi.mock("@/server/services/overview", () => ({ loadOverviewSnapshot: mocks.overview }));
vi.mock("@/server/services/system", () => ({
  loadCoreSystemSources: mocks.systemSources,
  loadProfileFromEnvironment: mocks.profile,
  loadSkillPreview: mocks.skill,
  loadSystemPageData: mocks.system,
}));

import { resolveScopedPanel } from "@/server/panels/routing";
import {
  loadAgentConversationDetail,
  loadAgentConversationPage,
  loadAgentJobs,
  loadAgentOverview,
  loadAgentSystem,
  loadAgentSystemContext,
  loadAgentWorkspaceDirectory,
  loadAgentWorkspacePreview,
} from "@/server/services/agents";

const dualEnvironment = Object.freeze({
  COCKPIT_CODEX_HOME: "/synthetic/codex-home",
  COCKPIT_CODEX_WORKSPACE_ROOT: "/synthetic/codex-workspace",
  COCKPIT_HERMES_HOME: "/synthetic/hermes-home",
  COCKPIT_SOURCE_PRESET: "hermes-v2026.9.11",
  COCKPIT_WORKSPACE_ROOT: "/synthetic/hermes-workspace",
});

const codex = resolveScopedPanel("codex", dualEnvironment);
const hermes = resolveScopedPanel("hermes", dualEnvironment);

describe("fixed Agent service dispatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("dispatches Codex operations only to Codex services and forwards abort signals", async () => {
    const signal = new AbortController().signal;
    mocks.codexOverview.mockResolvedValue("codex-overview");
    mocks.codexSystem.mockResolvedValue("codex-system");
    mocks.codexTaskPage.mockResolvedValue("codex-page");
    mocks.codexTaskDetail.mockResolvedValue("codex-detail");

    await expect(loadAgentOverview(codex, { signal })).resolves.toBe("codex-overview");
    await expect(loadAgentSystem(codex, { signal })).resolves.toBe("codex-system");
    await expect(loadAgentConversationPage(codex, { cursor: "cursor-safe", signal })).resolves.toBe(
      "codex-page",
    );
    await expect(loadAgentConversationDetail(codex, "task-safe", { signal })).resolves.toBe(
      "codex-detail",
    );

    expect(mocks.codexOverview).toHaveBeenCalledWith(codex, { signal });
    expect(mocks.codexSystem).toHaveBeenCalledWith(codex, { signal });
    expect(mocks.codexTaskPage).toHaveBeenCalledWith(codex, { cursor: "cursor-safe", signal });
    expect(mocks.codexTaskDetail).toHaveBeenCalledWith(codex, "task-safe", { signal });
    expect(mocks.overview).not.toHaveBeenCalled();
    expect(mocks.conversationPage).not.toHaveBeenCalled();
  });

  it("composes Hermes Overview from only the selected panel sources", async () => {
    mocks.profile.mockResolvedValue("profile");
    mocks.conversationPage.mockResolvedValue("conversations");
    mocks.systemSources.mockResolvedValue("system");
    mocks.jobs.mockResolvedValue("jobs");
    mocks.filesDirectory.mockResolvedValue("workspace");
    mocks.overview.mockImplementation(async ({ readers }) => {
      await Promise.all([
        readers.profile(),
        readers.conversations(),
        readers.system(),
        readers.jobs(),
        readers.workspace(),
      ]);
      return "hermes-overview";
    });

    await expect(loadAgentOverview(hermes)).resolves.toBe("hermes-overview");

    expect(mocks.profile).toHaveBeenCalledWith(
      expect.objectContaining({
        environment: {
          COCKPIT_HERMES_HOME: "/synthetic/hermes-home",
          COCKPIT_SOURCE_PRESET: "hermes-v2026.9.11",
          COCKPIT_WORKSPACE_ROOT: "/synthetic/hermes-workspace",
        },
      }),
    );
    expect(mocks.conversationPage).toHaveBeenCalledWith(
      null,
      5,
      expect.objectContaining({
        environment: {
          COCKPIT_HERMES_HOME: "/synthetic/hermes-home",
          COCKPIT_SOURCE_PRESET: "hermes-v2026.9.11",
        },
        identityCodec: expect.any(Object),
      }),
    );
    expect(mocks.systemSources).toHaveBeenCalledTimes(1);
    expect(mocks.jobs).toHaveBeenCalledWith(
      expect.objectContaining({
        environment: {
          COCKPIT_HERMES_HOME: "/synthetic/hermes-home",
          COCKPIT_SOURCE_PRESET: "hermes-v2026.9.11",
        },
      }),
    );
    expect(mocks.filesDirectory).toHaveBeenCalledWith("", {
      workspaceRoot: "/synthetic/hermes-workspace",
    });
    expect(mocks.codexOverview).not.toHaveBeenCalled();
  });

  it("keeps System, detail, Files, and Jobs bound to the requested runtime", async () => {
    mocks.system.mockResolvedValue("hermes-system");
    mocks.skill.mockResolvedValue("hermes-skill");
    mocks.conversationPage.mockResolvedValue("hermes-page");
    mocks.conversationTranscript.mockResolvedValue("hermes-detail");
    mocks.filesDirectory.mockResolvedValue("directory");
    mocks.filesPreview.mockResolvedValue("preview");
    mocks.jobs.mockResolvedValue("jobs");

    await expect(loadAgentSystem(hermes)).resolves.toBe("hermes-system");
    await expect(loadAgentSystemContext(hermes, "skill-safe")).resolves.toBe("hermes-skill");
    await expect(loadAgentConversationPage(hermes, { cursor: "cursor-safe" })).resolves.toBe(
      "hermes-page",
    );
    await expect(loadAgentConversationDetail(hermes, "task-safe")).resolves.toBe("hermes-detail");
    await expect(loadAgentWorkspaceDirectory(codex, "src")).resolves.toBe("directory");
    await expect(loadAgentWorkspacePreview(codex, "README.md")).resolves.toBe("preview");
    await expect(loadAgentJobs(hermes)).resolves.toBe("jobs");

    expect(mocks.filesDirectory).toHaveBeenCalledWith("src", {
      workspaceRoot: "/synthetic/codex-workspace",
    });
    expect(mocks.filesPreview).toHaveBeenCalledWith("README.md", {
      workspaceRoot: "/synthetic/codex-workspace",
    });
    expect(() => loadAgentSystemContext(codex, "skill-safe")).toThrowError(
      expect.objectContaining({ code: "unsupported_capability" }),
    );
    expect(() => loadAgentJobs(codex)).toThrowError(
      expect.objectContaining({ code: "unsupported_capability" }),
    );
  });

  it("refuses Codex Files when no explicit workspace root is configured", () => {
    const codexWithoutFiles = resolveScopedPanel("codex", {
      COCKPIT_CODEX_HOME: "/synthetic/codex-home",
    });

    expect(() => loadAgentWorkspaceDirectory(codexWithoutFiles, "")).toThrowError(
      expect.objectContaining({ code: "unsupported_capability" }),
    );
    expect(() => loadAgentWorkspacePreview(codexWithoutFiles, "README.md")).toThrowError(
      expect.objectContaining({ code: "unsupported_capability" }),
    );
    expect(mocks.filesDirectory).not.toHaveBeenCalled();
    expect(mocks.filesPreview).not.toHaveBeenCalled();
  });
});
