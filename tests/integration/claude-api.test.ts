// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, expect, it, vi } from "vitest";
import type { z } from "zod";

import * as detailRoute from "@/app/api/agents/[panelId]/conversations/[id]/route";
import * as listRoute from "@/app/api/agents/[panelId]/conversations/route";
import * as overviewRoute from "@/app/api/agents/[panelId]/overview/route";
import * as systemRoute from "@/app/api/agents/[panelId]/system/route";
import * as filesRoute from "@/app/api/agents/[panelId]/files/route";
import * as previewRoute from "@/app/api/agents/[panelId]/files/preview/route";
import * as jobsRoute from "@/app/api/agents/[panelId]/jobs/route";
import { scopedFailureSchema, scopedSuccessSchema } from "@/contracts/agents";
import { claudeSessionDetailSchema, claudeSessionPageSchema } from "@/contracts/claude";
import { claudeSystemSnapshotSchema } from "@/contracts/claude-system";
import { claudeOverviewSnapshotSchema } from "@/contracts/claude-overview";
import { workspaceDirectorySchema, workspaceFileSchema } from "@/contracts/source-result";
import { createClaudeFixture, forbiddenClaudeFixtureMarkers } from "../helpers/claude-fixture";

const base = "http://127.0.0.1:3000/api/agents/claude-code";
const roots: string[] = [];

function expectPrivateJson(response: Response, status: number) {
  expect(response.status).toBe(status);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("content-type")).toContain("application/json");
  expect(response.headers.get("access-control-allow-origin")).toBeNull();
}

async function readData<T>(response: Response, schema: z.ZodType<T>): Promise<T> {
  expectPrivateJson(response, 200);
  const envelope = scopedSuccessSchema(schema).parse(await response.json());
  expect(envelope.panelId).toBe("claude-code");
  expect(envelope.runtime).toBe("claude-code");
  return envelope.data;
}

afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function configureFixture() {
  const root = mkdtempSync(path.join(tmpdir(), "cockpit-claude-api-"));
  roots.push(root);
  const fixture = createClaudeFixture(root);
  for (const key of [
    "COCKPIT_WORKSPACE_ROOT",
    "COCKPIT_SOURCE_PRESET",
    "COCKPIT_SOURCE_MANIFEST",
    "COCKPIT_HERMES_HOME",
    "HERMES_HOME",
    "COCKPIT_CODEX_HOME",
    "COCKPIT_CODEX_WORKSPACE_ROOT",
    "COCKPIT_CODEX_CUSTOM_GUIDANCE",
    "COCKPIT_DEFAULT_PANEL",
    "COCKPIT_BUILD_SOURCE_READ_GUARD",
    "COCKPIT_CLAUDE_SESSION_ROOT",
  ])
    vi.stubEnv(key, "");
  for (const [key, value] of Object.entries(fixture.environment)) vi.stubEnv(key, value);
  return fixture;
}

it("serves the real Claude reader through scoped list/detail routes with private envelopes and bounded errors", async () => {
  const fixture = configureFixture();
  const context = { params: Promise.resolve({ panelId: "claude-code" }) };

  const page = await readData(
    await listRoute.GET(new Request(`${base}/conversations`), context),
    claudeSessionPageSchema,
  );
  expect(page.items).toHaveLength(5);
  expect(page.items[0]).toMatchObject({
    id: expect.stringMatching(/^task-/u),
    title: "Inspect saved changes",
    preview: "Review the saved changes in this project.",
    directoryName: "atlas-demo",
    gitBranch: "fix/session-reading",
    issue: null,
  });
  expect(page.nextCursor).toMatch(/^cursor-/u);
  const selectedId = page.items[0]!.id;
  const detail = await readData(
    await detailRoute.GET(new Request(`${base}/conversations/${selectedId}`), {
      params: Promise.resolve({ panelId: "claude-code", id: selectedId }),
    }),
    claudeSessionDetailSchema,
  );
  expect(detail.id).toBe(selectedId);
  expect(detail.messages.map((message) => message.role)).toEqual([
    "user",
    "assistant",
    "assistant",
    "assistant",
  ]);
  expect(detail).toMatchObject({ directoryName: "atlas-demo", gitBranch: "fix/session-reading" });
  expect(detail.messages[1]!.content).toBeNull();
  expect(detail.messages[2]!.content).toBe("I will check the revised changes.");
  expect(detail.messages.at(-1)?.content).toContain(
    "The selected saved changes are ready to inspect.",
  );
  expect(detail.activities.map(({ category, state }) => ({ category, state }))).toEqual([
    { category: "Read", state: "result_recorded" },
    { category: "Command", state: "recorded_error" },
    { category: "Edit", state: "no_result_recorded" },
    { category: "Other", state: "no_result_recorded" },
    { category: "Command", state: "result_recorded" },
  ]);
  expect(
    detail.activities
      .slice(0, 4)
      .every((activity) => activity.messageKey === detail.messages[1]!.key),
  ).toBe(true);
  expect(detail.activities[4]!.messageKey).toBe(detail.messages[2]!.key);
  expect(detail.activities[0]).toMatchObject({
    label: "Read src/settings.ts",
    filePath: "src/settings.ts",
  });
  expect(detail.activities[1]).toMatchObject({
    command: "pnpm test",
    result: { text: expect.stringContaining("Settings test failed") },
  });
  expect(detail.activities[4]).toMatchObject({
    command: "pnpm test",
    result: { text: expect.stringContaining("12 settings checks passed.") },
  });
  const olderPage = await readData(
    await listRoute.GET(
      new Request(`${base}/conversations?cursor=${encodeURIComponent(page.nextCursor!)}`),
      context,
    ),
    claudeSessionPageSchema,
  );
  expect(olderPage.items.map((session) => session.title)).toEqual([
    "Saved session 6",
    "Saved session 7",
  ]);
  expect(olderPage.nextCursor).toBeNull();

  const serialized = JSON.stringify({ page, detail, olderPage });
  for (const marker of [...forbiddenClaudeFixtureMarkers, ...fixture.ids, fixture.sessionRoot])
    expect(serialized).not.toContain(marker);

  const rawId = fixture.ids[0]!;
  const rawIdResponse = await detailRoute.GET(new Request(`${base}/conversations/${rawId}`), {
    params: Promise.resolve({ panelId: "claude-code", id: rawId }),
  });
  expectPrivateJson(rawIdResponse, 400);
  expect(scopedFailureSchema.parse(await rawIdResponse.json())).toMatchObject({
    panelId: "claude-code",
    code: "invalid_path",
  });
  const unsupportedResponse = await jobsRoute.GET(new Request(`${base}/jobs`), context);
  expectPrivateJson(unsupportedResponse, 404);
  expect(scopedFailureSchema.parse(await unsupportedResponse.json())).toMatchObject({
    panelId: "claude-code",
    code: "unsupported_capability",
  });
});

it("keeps project sessions, cursors, System and Files in the same explicit scope", async () => {
  const fixture = configureFixture();
  const context = { params: Promise.resolve({ panelId: "claude-code" }) };
  const atlas = await readData(
    await listRoute.GET(new Request(`${base}/conversations?project=atlas`), context),
    claudeSessionPageSchema,
  );
  const notes = await readData(
    await listRoute.GET(new Request(`${base}/conversations?project=notes`), context),
    claudeSessionPageSchema,
  );
  expect(notes.items.map(({ title }) => title)).toEqual(["Plan the release notes"]);
  expect(notes.items[0]!.id).not.toBe(atlas.items[0]!.id);
  const overview = await readData(
    await overviewRoute.GET(new Request(`${base}/overview?project=notes`), context),
    claudeOverviewSnapshotSchema,
  );
  expect(overview.project).toEqual({ id: "notes", name: "Notes" });
  expect(overview.sessions?.items.map(({ title }) => title)).toEqual(["Plan the release notes"]);
  expect(overview.system?.counts).toMatchObject({
    Instructions: 2,
    Memory: 1,
    Skills: 1,
    Subagents: 0,
  });
  expect(overview.files?.entries).toBeGreaterThan(0);
  for (const response of [
    await detailRoute.GET(
      new Request(`${base}/conversations/${atlas.items[0]!.id}?project=notes`),
      { params: Promise.resolve({ panelId: "claude-code", id: atlas.items[0]!.id }) },
    ),
    await listRoute.GET(
      new Request(
        `${base}/conversations?project=notes&cursor=${encodeURIComponent(atlas.nextCursor!)}`,
      ),
      context,
    ),
    await listRoute.GET(new Request(`${base}/conversations?project=unknown`), context),
    await systemRoute.GET(new Request(`${base}/system?project=atlas&project=notes`), context),
    await filesRoute.GET(
      new Request(`${base}/files?project=${encodeURIComponent(fixture.workspaceRoot)}`),
      context,
    ),
  ]) {
    expectPrivateJson(response, 400);
    expect(scopedFailureSchema.parse(await response.json())).toMatchObject({
      code: "invalid_path",
    });
  }
  const atlasSystem = await readData(
    await systemRoute.GET(new Request(`${base}/system?project=atlas`), context),
    claudeSystemSnapshotSchema,
  );
  const notesSystem = await readData(
    await systemRoute.GET(new Request(`${base}/system?project=notes`), context),
    claudeSystemSnapshotSchema,
  );
  expect(new Set(atlasSystem.sources.map(({ category }) => category))).toEqual(
    new Set(["Instructions", "Memory", "Skills", "Subagents"]),
  );
  expect(atlasSystem.sources).toContainEqual(
    expect.objectContaining({
      scope: "User",
      relativePath: "CLAUDE.md",
      content: expect.stringContaining("Shared guidance"),
    }),
  );
  expect(JSON.stringify(atlasSystem)).toContain("Atlas guidance");
  expect(JSON.stringify(atlasSystem)).not.toContain("Notes guidance");
  expect(JSON.stringify(notesSystem)).toContain("Notes guidance");
  expect(JSON.stringify(notesSystem)).not.toContain("Atlas guidance");
  const directory = await readData(
    await filesRoute.GET(new Request(`${base}/files?project=notes&path=docs`), context),
    workspaceDirectorySchema,
  );
  expect(directory.items.map(({ name }) => name)).toEqual(["release-plan.md"]);
  const file = await readData(
    await previewRoute.GET(
      new Request(`${base}/files/preview?project=atlas&path=src/settings.ts`),
      context,
    ),
    workspaceFileSchema,
  );
  expect(file.content).toContain("notifications: true");
  const otherProject = await previewRoute.GET(
    new Request(`${base}/files/preview?project=notes&path=src/settings.ts`),
    context,
  );
  expectPrivateJson(otherProject, 404);
  for (const requestedPath of [
    "../atlas-demo/src/settings.ts",
    ".env",
    ".claude/settings.json",
    fixture.workspaceRoot,
  ]) {
    const response = await previewRoute.GET(
      new Request(`${base}/files/preview?project=atlas&path=${encodeURIComponent(requestedPath)}`),
      context,
    );
    expect(response.status).toBeGreaterThanOrEqual(400);
  }
  const serialized = JSON.stringify({
    atlas,
    notes,
    overview,
    atlasSystem,
    notesSystem,
    directory,
    file,
  });
  for (const marker of [...forbiddenClaudeFixtureMarkers, fixture.root, fixture.userRoot])
    expect(serialized).not.toContain(marker);
});
