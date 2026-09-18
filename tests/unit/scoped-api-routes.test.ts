import { beforeEach, describe, expect, it, vi } from "vitest";

const services = vi.hoisted(() => ({
  loadAgentConversationDetail: vi.fn(),
  loadAgentConversationPage: vi.fn(),
  loadAgentJobs: vi.fn(),
  loadAgentOverview: vi.fn(),
  loadAgentSystem: vi.fn(),
  loadAgentSystemContext: vi.fn(),
  loadAgentWorkspaceDirectory: vi.fn(),
  loadAgentWorkspacePreview: vi.fn(),
}));

vi.mock("@/server/services/agents", () => services);

import * as conversationDetailRoute from "@/app/api/agents/[panelId]/conversations/[id]/route";
import * as conversationsRoute from "@/app/api/agents/[panelId]/conversations/route";
import * as filePreviewRoute from "@/app/api/agents/[panelId]/files/preview/route";
import * as filesRoute from "@/app/api/agents/[panelId]/files/route";
import * as jobsRoute from "@/app/api/agents/[panelId]/jobs/route";
import * as overviewRoute from "@/app/api/agents/[panelId]/overview/route";
import * as systemContextRoute from "@/app/api/agents/[panelId]/system/context/route";
import * as systemRoute from "@/app/api/agents/[panelId]/system/route";

const observedAt = "2026-09-16T08:00:00.000Z";
const skillId = "skill-0123456789abcdef01234567";

const hermesOverview = {
  observedAt,
  profile: {
    state: "ready",
    observedAt,
    profile: "default",
    homeLabel: "Configured Hermes home",
    configState: "ready",
    model: "fixture-model",
    provider: "fixture-provider",
  },
  conversations: {
    state: "ready",
    observedAt,
    items: [],
    hasMore: false,
  },
  system: {
    state: "ready",
    observedAt,
    items: [],
  },
  jobs: {
    state: "ready",
    observedAt,
    total: 0,
    enabled: 0,
    paused: 0,
    failedLastRun: 0,
    executionsState: "ready",
    nextEvent: null,
  },
  workspace: {
    state: "ready",
    observedAt,
    loadedCount: 0,
    truncated: false,
    items: [],
  },
} as const;

const hermesSystemSource = {
  id: skillId,
  title: "Fixture guidance",
  category: "Guidance",
  summary: "Synthetic route fixture.",
  content: "Synthetic content only.",
  stamp: {
    id: "fixture-guidance",
    label: "Fixture guidance",
    path: "approved-fixture",
    observedAt,
    state: "ready",
  },
  metadata: [],
} as const;

const hermesSystem = {
  profile: {
    profile: "default",
    profileKind: "default",
    homeLabel: "Configured Hermes home",
    resolutionSource: "explicit",
    configState: "ready",
    model: "fixture-model",
    provider: "fixture-provider",
  },
  sources: [hermesSystemSource],
} as const;

const hermesConversationPage = {
  items: [],
  nextCursor: null,
  observedAt,
} as const;

const hermesConversation = {
  id: "task-safe",
  title: "Synthetic task",
  preview: "Synthetic preview.",
  source: "fixture",
  lastActivity: observedAt,
  model: "fixture-model",
  messageCount: 1,
  toolCallCount: 0,
  profile: "default",
  workspace: "fixture-workspace",
  messages: [
    {
      id: "message-1",
      role: "user",
      content: "Synthetic message.",
      timestamp: observedAt,
    },
  ],
} as const;

const workspaceDirectory = {
  path: "",
  parentPath: null,
  items: [],
  observedAt,
  truncated: false,
} as const;

const workspacePreview = {
  id: "README.md",
  name: "README.md",
  path: "README.md",
  entryType: "file",
  kind: "Markdown",
  size: "23 B",
  sizeBytes: 23,
  modifiedAt: observedAt,
  previewState: "available",
  content: "Synthetic preview only.",
  truncated: false,
} as const;

const jobsSnapshot = {
  jobs: [],
  observedAt,
  definitionsState: "ready",
  executionsState: "ready",
} as const;

const codexOverview = {
  panelName: "Codex",
  observedAt,
  runtime: {
    state: "ready",
    observedAt,
    label: "Codex CLI",
    version: "0.145.0",
  },
  tasks: {
    state: "ready",
    observedAt,
    items: [],
    hasMore: false,
  },
  guidance: {
    state: "ready",
    observedAt,
    items: [],
  },
  workspace: {
    state: "ready",
    observedAt,
    loadedCount: 0,
    truncated: false,
    items: [],
  },
} as const;

const codexSystem = {
  runtime: {
    label: "Codex CLI",
    state: "ready",
    version: "0.145.0",
  },
  sources: [],
  observedAt,
} as const;

const codexTaskPage = {
  items: [],
  nextCursor: null,
  observedAt,
  indexScope: "Codex state database",
  inventoryNote: "State-database index; some local tasks may be absent.",
} as const;

const codexTaskDetail = {
  summary: {
    id: "task-safe",
    title: null,
    preview: null,
    source: "App Server",
    lastActivity: null,
    status: "idle",
    projectLabel: null,
  },
  turns: [],
  observedAt,
  omitted: [],
} as const;

function configureSyntheticDualMode(): void {
  vi.stubEnv("COCKPIT_CODEX_HOME", "/synthetic/codex-home");
  vi.stubEnv("COCKPIT_CODEX_WORKSPACE_ROOT", "/synthetic/codex-workspace");
  vi.stubEnv("COCKPIT_CODEX_CUSTOM_GUIDANCE", "");
  vi.stubEnv("COCKPIT_DEFAULT_PANEL", "");
  vi.stubEnv("COCKPIT_WORKSPACE_ROOT", "/synthetic/hermes-workspace");
  vi.stubEnv("COCKPIT_SOURCE_PRESET", "hermes-v2026.9.11");
  vi.stubEnv("COCKPIT_SOURCE_MANIFEST", "");
  vi.stubEnv("COCKPIT_HERMES_HOME", "/synthetic/hermes-home");
}

function configureHermesResponses(): void {
  services.loadAgentOverview.mockResolvedValue(hermesOverview);
  services.loadAgentSystem.mockResolvedValue(hermesSystem);
  services.loadAgentSystemContext.mockResolvedValue(hermesSystemSource);
  services.loadAgentConversationPage.mockResolvedValue(hermesConversationPage);
  services.loadAgentConversationDetail.mockResolvedValue(hermesConversation);
  services.loadAgentWorkspaceDirectory.mockResolvedValue(workspaceDirectory);
  services.loadAgentWorkspacePreview.mockResolvedValue(workspacePreview);
  services.loadAgentJobs.mockResolvedValue(jobsSnapshot);
}

function expectPrivateJson(response: Response): void {
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("content-type")).toContain("application/json");
  expect(response.headers.get("access-control-allow-origin")).toBeNull();
}

describe("scoped Agent API routes", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    configureSyntheticDualMode();
    configureHermesResponses();
  });

  it("returns strict scoped envelopes and private JSON headers for all eight GET routes", async () => {
    const base = "http://127.0.0.1:3000";
    const cases = [
      {
        expected: hermesOverview,
        response: overviewRoute.GET(new Request(`${base}/api/agents/hermes/overview`), {
          params: Promise.resolve({ panelId: "hermes" }),
        }),
      },
      {
        expected: hermesSystem,
        response: systemRoute.GET(new Request(`${base}/api/agents/hermes/system`), {
          params: Promise.resolve({ panelId: "hermes" }),
        }),
      },
      {
        expected: hermesSystemSource,
        response: systemContextRoute.GET(
          new Request(`${base}/api/agents/hermes/system/context?id=${skillId}`),
          { params: Promise.resolve({ panelId: "hermes" }) },
        ),
      },
      {
        expected: hermesConversationPage,
        response: conversationsRoute.GET(new Request(`${base}/api/agents/hermes/conversations`), {
          params: Promise.resolve({ panelId: "hermes" }),
        }),
      },
      {
        expected: hermesConversation,
        response: conversationDetailRoute.GET(
          new Request(`${base}/api/agents/hermes/conversations/task-safe`),
          { params: Promise.resolve({ panelId: "hermes", id: "task-safe" }) },
        ),
      },
      {
        expected: workspaceDirectory,
        response: filesRoute.GET(new Request(`${base}/api/agents/hermes/files`), {
          params: Promise.resolve({ panelId: "hermes" }),
        }),
      },
      {
        expected: workspacePreview,
        response: filePreviewRoute.GET(
          new Request(`${base}/api/agents/hermes/files/preview?path=README.md`),
          { params: Promise.resolve({ panelId: "hermes" }) },
        ),
      },
      {
        expected: jobsSnapshot,
        response: jobsRoute.GET(new Request(`${base}/api/agents/hermes/jobs`), {
          params: Promise.resolve({ panelId: "hermes" }),
        }),
      },
    ] as const;

    for (const routeCase of cases) {
      const response = await routeCase.response;
      expectPrivateJson(response);
      expect(await response.json()).toEqual({
        panelId: "hermes",
        runtime: "hermes",
        data: routeCase.expected,
      });
    }
  });

  it("rejects an unknown panel before query parsing or any source service and never echoes it", async () => {
    const base = "http://127.0.0.1:3000";
    const invalidPanel = "invalid-agent";
    const responses = [
      overviewRoute.GET(new Request(`${base}/api/agents/invalid-agent/overview?source=/private`), {
        params: Promise.resolve({ panelId: invalidPanel }),
      }),
      systemRoute.GET(new Request(`${base}/api/agents/invalid-agent/system?source=/private`), {
        params: Promise.resolve({ panelId: invalidPanel }),
      }),
      systemContextRoute.GET(
        new Request(`${base}/api/agents/invalid-agent/system/context?id=../private`),
        { params: Promise.resolve({ panelId: invalidPanel }) },
      ),
      conversationsRoute.GET(
        new Request(`${base}/api/agents/invalid-agent/conversations?limit=999`),
        { params: Promise.resolve({ panelId: invalidPanel }) },
      ),
      conversationDetailRoute.GET(
        new Request(`${base}/api/agents/invalid-agent/conversations/raw-id?unexpected=1`),
        { params: Promise.resolve({ panelId: invalidPanel, id: "raw-id" }) },
      ),
      filesRoute.GET(new Request(`${base}/api/agents/invalid-agent/files?path=..%2Fprivate`), {
        params: Promise.resolve({ panelId: invalidPanel }),
      }),
      filePreviewRoute.GET(new Request(`${base}/api/agents/invalid-agent/files/preview`), {
        params: Promise.resolve({ panelId: invalidPanel }),
      }),
      jobsRoute.GET(new Request(`${base}/api/agents/invalid-agent/jobs?source=/private`), {
        params: Promise.resolve({ panelId: invalidPanel }),
      }),
    ];

    for (const pendingResponse of responses) {
      const response = await pendingResponse;
      const body = await response.json();
      expect(response.status).toBe(404);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(body).toMatchObject({ code: "invalid_panel" });
      expect(body).not.toHaveProperty("panelId");
      expect(JSON.stringify(body)).not.toContain(invalidPanel);
    }
    for (const service of Object.values(services)) expect(service).not.toHaveBeenCalled();
  });

  it("rejects Codex Jobs and context before invalid query parsing or service dispatch", async () => {
    const base = "http://127.0.0.1:3000";
    const responses = [
      await jobsRoute.GET(new Request(`${base}/api/agents/codex/jobs?source=/private`), {
        params: Promise.resolve({ panelId: "codex" }),
      }),
      await systemContextRoute.GET(
        new Request(`${base}/api/agents/codex/system/context?id=../private`),
        { params: Promise.resolve({ panelId: "codex" }) },
      ),
    ];

    for (const response of responses) {
      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toMatchObject({
        panelId: "codex",
        code: "unsupported_capability",
      });
    }
    expect(services.loadAgentJobs).not.toHaveBeenCalled();
    expect(services.loadAgentSystemContext).not.toHaveBeenCalled();
  });

  it("rejects Codex Files before path parsing when no workspace root is configured", async () => {
    vi.stubEnv("COCKPIT_CODEX_WORKSPACE_ROOT", "");

    const response = await filesRoute.GET(
      new Request("http://127.0.0.1:3000/api/agents/codex/files?path=..%2Fprivate"),
      { params: Promise.resolve({ panelId: "codex" }) },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      panelId: "codex",
      code: "unsupported_capability",
    });
    expect(services.loadAgentWorkspaceDirectory).not.toHaveBeenCalled();
  });

  it("turns an invalid outgoing DTO into a redacted protocol_violation", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    services.loadAgentOverview.mockResolvedValue({
      ...hermesOverview,
      privateConfig: { token: "must-not-leak" },
    });

    const response = await overviewRoute.GET(
      new Request("http://127.0.0.1:3000/api/agents/hermes/overview"),
      { params: Promise.resolve({ panelId: "hermes" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(body).toMatchObject({
      panelId: "hermes",
      sourceId: "overview",
      code: "protocol_violation",
      message: "The local Agent reader returned an invalid response.",
    });
    expect(body).not.toHaveProperty("privateConfig");
    expect(JSON.stringify(body)).not.toContain("must-not-leak");
  });

  it("forwards each Codex read request signal through the route boundary", async () => {
    services.loadAgentOverview.mockResolvedValue(codexOverview);
    services.loadAgentSystem.mockResolvedValue(codexSystem);
    services.loadAgentConversationPage.mockResolvedValue(codexTaskPage);
    services.loadAgentConversationDetail.mockResolvedValue(codexTaskDetail);

    const overviewRequest = new Request("http://127.0.0.1:3000/api/agents/codex/overview");
    const systemRequest = new Request("http://127.0.0.1:3000/api/agents/codex/system");
    const conversationsRequest = new Request(
      "http://127.0.0.1:3000/api/agents/codex/conversations",
    );
    const detailRequest = new Request(
      "http://127.0.0.1:3000/api/agents/codex/conversations/task-safe",
    );

    const responses = await Promise.all([
      overviewRoute.GET(overviewRequest, {
        params: Promise.resolve({ panelId: "codex" }),
      }),
      systemRoute.GET(systemRequest, {
        params: Promise.resolve({ panelId: "codex" }),
      }),
      conversationsRoute.GET(conversationsRequest, {
        params: Promise.resolve({ panelId: "codex" }),
      }),
      conversationDetailRoute.GET(detailRequest, {
        params: Promise.resolve({ panelId: "codex", id: "task-safe" }),
      }),
    ]);

    for (const response of responses) expect(response.status).toBe(200);
    expect(services.loadAgentOverview).toHaveBeenCalledWith(
      expect.objectContaining({ id: "codex", runtime: "codex" }),
      { signal: overviewRequest.signal },
    );
    expect(services.loadAgentSystem).toHaveBeenCalledWith(
      expect.objectContaining({ id: "codex", runtime: "codex" }),
      { signal: systemRequest.signal },
    );
    expect(services.loadAgentConversationPage).toHaveBeenCalledWith(
      expect.objectContaining({ id: "codex", runtime: "codex" }),
      { cursor: null, signal: conversationsRequest.signal },
    );
    expect(services.loadAgentConversationDetail).toHaveBeenCalledWith(
      expect.objectContaining({ id: "codex", runtime: "codex" }),
      "task-safe",
      { signal: detailRequest.signal },
    );
  });

  it.each([
    ["overview", overviewRoute],
    ["system", systemRoute],
    ["system/context", systemContextRoute],
    ["conversations", conversationsRoute],
    ["conversations/[id]", conversationDetailRoute],
    ["files", filesRoute],
    ["files/preview", filePreviewRoute],
    ["jobs", jobsRoute],
  ])("exports GET only for %s", (_name, routeModule) => {
    expect(Object.keys(routeModule)).toEqual(["GET"]);
  });
});
