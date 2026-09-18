// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import * as conversationDetailRoute from "@/app/api/agents/[panelId]/conversations/[id]/route";
import * as conversationsRoute from "@/app/api/agents/[panelId]/conversations/route";
import * as filePreviewRoute from "@/app/api/agents/[panelId]/files/preview/route";
import * as filesRoute from "@/app/api/agents/[panelId]/files/route";
import * as jobsRoute from "@/app/api/agents/[panelId]/jobs/route";
import * as overviewRoute from "@/app/api/agents/[panelId]/overview/route";
import * as systemContextRoute from "@/app/api/agents/[panelId]/system/context/route";
import * as systemRoute from "@/app/api/agents/[panelId]/system/route";
import { scopedSuccessSchema, type AgentRuntime } from "@/contracts/agents";
import {
  conversationPageSchema,
  conversationSchema,
  jobsSnapshotSchema,
  overviewSnapshotSchema,
  systemSnapshotSchema,
  systemSourceSchema,
  workspaceDirectorySchema,
  workspaceFileSchema,
} from "@/contracts/source-result";
import { panelTokenCodec, type PanelTokenScope } from "@/server/panels/opaque-token";
import {
  assertHermesFixtureSourcesUnchanged,
  createHermesFixture,
  forbiddenHermesFixtureMarkers,
  type HermesFixture,
  privateHermesFixturePersistenceMarkers,
  removeHermesFixture,
  snapshotHermesFixtureSources,
} from "../helpers/hermes-fixture";

const base = "http://127.0.0.1:3000";
const hermesScope = Object.freeze({
  panelId: "hermes",
  runtime: "hermes",
  adapterVersion: "hermes-v1",
} satisfies PanelTokenScope);
const codexScope = Object.freeze({
  panelId: "codex",
  runtime: "codex",
  adapterVersion: "codex-0.145.0",
} satisfies PanelTokenScope);

async function readScopedData<T>(
  response: Response,
  runtime: AgentRuntime,
  schema: z.ZodType<T>,
): Promise<T> {
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(
    [...response.headers.keys()].filter((key) => key.startsWith("access-control-allow-")),
  ).toEqual([]);
  const envelope = scopedSuccessSchema(schema).parse(await response.json());
  expect(envelope.panelId).toBe(runtime);
  expect(envelope.runtime).toBe(runtime);
  return envelope.data;
}

function configureDualPanels(fixture: HermesFixture, codexWorkspace: string): void {
  for (const key of [
    "COCKPIT_SOURCE_MANIFEST",
    "COCKPIT_CODEX_CUSTOM_GUIDANCE",
    "COCKPIT_DEFAULT_PANEL",
  ]) {
    vi.stubEnv(key, "");
  }
  for (const [name, value] of Object.entries(fixture.environment)) {
    vi.stubEnv(name, value);
  }
  vi.stubEnv("COCKPIT_CODEX_HOME", path.join(codexWorkspace, "codex-home-not-needed"));
  vi.stubEnv("COCKPIT_CODEX_WORKSPACE_ROOT", codexWorkspace);
}

describe("scoped Agent APIs with synthetic Hermes sources", () => {
  const fixtures: HermesFixture[] = [];
  const temporaryRoots: string[] = [];

  afterEach(() => {
    vi.unstubAllEnvs();
    for (const fixture of fixtures.splice(0)) removeHermesFixture(fixture);
    for (const root of temporaryRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("serves every Hermes surface in a strict panel envelope without leaking or mutating sources", async () => {
    const fixture = createHermesFixture("cockpit-scoped-api-hermes-");
    const codexWorkspace = mkdtempSync(path.join(tmpdir(), "cockpit-scoped-api-codex-"));
    fixtures.push(fixture);
    temporaryRoots.push(codexWorkspace);
    configureDualPanels(fixture, codexWorkspace);
    const sourceSnapshot = snapshotHermesFixtureSources(fixture);

    try {
      const overview = await readScopedData(
        await overviewRoute.GET(new Request(`${base}/api/agents/hermes/overview`), {
          params: Promise.resolve({ panelId: "hermes" }),
        }),
        "hermes",
        overviewSnapshotSchema,
      );
      const system = await readScopedData(
        await systemRoute.GET(new Request(`${base}/api/agents/hermes/system`), {
          params: Promise.resolve({ panelId: "hermes" }),
        }),
        "hermes",
        systemSnapshotSchema,
      );
      const skillId = system.sources.find((source) => source.collection?.kind === "skills")
        ?.collection?.items[0]?.id;
      expect(skillId).toMatch(/^skill-[a-f0-9]{24}$/u);
      const systemContext = await readScopedData(
        await systemContextRoute.GET(
          new Request(
            `${base}/api/agents/hermes/system/context?id=${encodeURIComponent(skillId!)}`,
          ),
          { params: Promise.resolve({ panelId: "hermes" }) },
        ),
        "hermes",
        systemSourceSchema,
      );

      const conversations = await readScopedData(
        await conversationsRoute.GET(new Request(`${base}/api/agents/hermes/conversations`), {
          params: Promise.resolve({ panelId: "hermes" }),
        }),
        "hermes",
        conversationPageSchema,
      );
      expect(conversations.items).toHaveLength(5);
      expect(conversations.items.every((item) => item.id.startsWith("task-"))).toBe(true);
      expect(overview.conversations.items.every((item) => item.id.startsWith("task-"))).toBe(true);
      expect(conversations.nextCursor).toMatch(/^cursor-/u);

      const conversationId = conversations.items[0]!.id;
      expect(panelTokenCodec.decodeTask(hermesScope, conversationId)).toBe(
        "RAW_SESSION_ID_MARKER_1",
      );
      expect(() => panelTokenCodec.decodeTask(codexScope, conversationId)).toThrowError(
        expect.objectContaining({ code: "invalid_path" }),
      );
      const rawCursor = panelTokenCodec.decodeCursor(hermesScope, conversations.nextCursor!);
      expect(JSON.parse(rawCursor)).toEqual({
        rawId: "RAW_SESSION_ID_MARKER_5",
        time: expect.any(Number),
      });
      expect(() =>
        panelTokenCodec.decodeCursor(codexScope, conversations.nextCursor!),
      ).toThrowError(expect.objectContaining({ code: "invalid_path" }));

      const olderConversations = await readScopedData(
        await conversationsRoute.GET(
          new Request(
            `${base}/api/agents/hermes/conversations?cursor=${encodeURIComponent(conversations.nextCursor!)}`,
          ),
          { params: Promise.resolve({ panelId: "hermes" }) },
        ),
        "hermes",
        conversationPageSchema,
      );
      expect(olderConversations.items.map((item) => item.title)).toEqual([
        "Synthetic conversation 6",
      ]);
      expect(olderConversations.nextCursor).toBeNull();

      const conversation = await readScopedData(
        await conversationDetailRoute.GET(
          new Request(`${base}/api/agents/hermes/conversations/${conversationId}`),
          { params: Promise.resolve({ panelId: "hermes", id: conversationId }) },
        ),
        "hermes",
        conversationSchema,
      );
      expect(conversation.id).toBe(conversationId);
      expect(conversation.messages.map(({ role }) => role)).toEqual(["user", "tool", "assistant"]);

      const rootFiles = await readScopedData(
        await filesRoute.GET(new Request(`${base}/api/agents/hermes/files`), {
          params: Promise.resolve({ panelId: "hermes" }),
        }),
        "hermes",
        workspaceDirectorySchema,
      );
      const file = await readScopedData(
        await filePreviewRoute.GET(
          new Request(`${base}/api/agents/hermes/files/preview?path=docs%2Fnotes.md`),
          { params: Promise.resolve({ panelId: "hermes" }) },
        ),
        "hermes",
        workspaceFileSchema,
      );
      const jobs = await readScopedData(
        await jobsRoute.GET(new Request(`${base}/api/agents/hermes/jobs`), {
          params: Promise.resolve({ panelId: "hermes" }),
        }),
        "hermes",
        jobsSnapshotSchema,
      );

      expect(systemContext.content).toContain("bounded-skill-marker");
      expect(rootFiles.items).toContainEqual(
        expect.objectContaining({
          entryType: "directory",
          path: "nested",
        }),
      );
      expect(file.content).toContain("[REDACTED]");
      expect(jobs).toMatchObject({ definitionsState: "ready", executionsState: "ready" });
      expect(jobs.jobs).toHaveLength(2);
      for (const section of [
        overview.profile,
        overview.conversations,
        overview.system,
        overview.jobs,
        overview.workspace,
      ]) {
        expect(section.state).toBe("ready");
      }

      const serialized = JSON.stringify({
        conversation,
        conversations,
        file,
        jobs,
        olderConversations,
        overview,
        rootFiles,
        system,
        systemContext,
      });
      for (const marker of [
        ...forbiddenHermesFixtureMarkers,
        ...privateHermesFixturePersistenceMarkers,
      ]) {
        expect(serialized).not.toContain(marker);
      }
    } finally {
      assertHermesFixtureSourcesUnchanged(sourceSnapshot);
    }
  });

  it("isolates Codex Files to its explicit workspace root without starting App Server", async () => {
    const fixture = createHermesFixture("cockpit-scoped-files-hermes-");
    const codexWorkspace = mkdtempSync(path.join(tmpdir(), "cockpit-scoped-files-codex-"));
    fixtures.push(fixture);
    temporaryRoots.push(codexWorkspace);
    configureDualPanels(fixture, codexWorkspace);
    mkdirSync(path.join(codexWorkspace, "nested"));
    writeFileSync(
      path.join(codexWorkspace, "nested", "notes.md"),
      "# Codex\n\ncodex-workspace-only-marker",
      "utf8",
    );

    const codexDirectory = await readScopedData(
      await filesRoute.GET(new Request(`${base}/api/agents/codex/files?path=nested`), {
        params: Promise.resolve({ panelId: "codex" }),
      }),
      "codex",
      workspaceDirectorySchema,
    );
    const codexFile = await readScopedData(
      await filePreviewRoute.GET(
        new Request(`${base}/api/agents/codex/files/preview?path=nested%2Fnotes.md`),
        { params: Promise.resolve({ panelId: "codex" }) },
      ),
      "codex",
      workspaceFileSchema,
    );
    const hermesFile = await readScopedData(
      await filePreviewRoute.GET(
        new Request(`${base}/api/agents/hermes/files/preview?path=nested%2Fnotes.md`),
        { params: Promise.resolve({ panelId: "hermes" }) },
      ),
      "hermes",
      workspaceFileSchema,
    );

    expect(codexDirectory.items).toContainEqual(
      expect.objectContaining({
        path: "nested/notes.md",
        previewState: "available",
      }),
    );
    expect(codexFile.content).toContain("codex-workspace-only-marker");
    expect(codexFile.content).not.toContain("nested-file-marker");
    expect(hermesFile.content).toContain("nested-file-marker");
    expect(hermesFile.content).not.toContain("codex-workspace-only-marker");
  });
});
