import { copyFileSync, mkdirSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as conversationRoute from "@/app/api/conversations/[id]/route";
import * as conversationsRoute from "@/app/api/conversations/route";
import * as filePreviewRoute from "@/app/api/files/preview/route";
import * as filesRoute from "@/app/api/files/route";
import * as jobsRoute from "@/app/api/jobs/route";
import * as overviewRoute from "@/app/api/overview/route";
import * as systemContextRoute from "@/app/api/system/context/route";
import * as systemRoute from "@/app/api/system/route";
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
import { HERMES_SOURCE_PRESET_ID, resolveSourceManifest } from "@/server/config/source-manifest";
import {
  assertHermesFixtureSourcesUnchanged,
  createHermesFixture,
  forbiddenHermesFixtureMarkers,
  type HermesFixture,
  privateHermesFixturePersistenceMarkers,
  removeHermesFixture,
  snapshotHermesFixtureSources,
} from "../helpers/hermes-fixture";

const httpMethods = new Set(["GET", "HEAD", "OPTIONS", "POST", "PUT", "PATCH", "DELETE"]);

function routeFiles(directory: string, prefix = ""): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    return entry.isDirectory()
      ? routeFiles(path.join(directory, entry.name), relative)
      : entry.name === "route.ts"
        ? [relative]
        : [];
  });
}

async function readSafeJson(response: Response): Promise<unknown> {
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(
    [...response.headers.keys()].filter((key) => key.startsWith("access-control-allow-")),
  ).toEqual([]);
  return response.json() as Promise<unknown>;
}

describe("GET API security boundary with synthetic local sources", () => {
  const fixtures: HermesFixture[] = [];

  afterEach(() => {
    vi.unstubAllEnvs();
    for (const fixture of fixtures.splice(0)) removeHermesFixture(fixture);
  });

  it("returns strict private responses without forwarding credentials or mutating fixture sources", async () => {
    const fixture = createHermesFixture("cockpit-api-security-");
    fixtures.push(fixture);
    vi.stubEnv("COCKPIT_SOURCE_MANIFEST", "");
    for (const [name, value] of Object.entries(fixture.environment)) vi.stubEnv(name, value);
    expect(fixture.environment).not.toHaveProperty("COCKPIT_SOURCE_MANIFEST");
    const sourceSnapshot = snapshotHermesFixtureSources(fixture);
    const base = "http://127.0.0.1:3000";

    try {
      const overview = overviewSnapshotSchema.parse(
        await readSafeJson(await overviewRoute.GET(new Request(`${base}/api/overview`))),
      );
      const system = systemSnapshotSchema.parse(
        await readSafeJson(await systemRoute.GET(new Request(`${base}/api/system`))),
      );
      const skillId = system.sources.find((source) => source.collection?.kind === "skills")
        ?.collection?.items[0]?.id;
      expect(skillId).toMatch(/^skill-[a-f0-9]{24}$/u);
      const systemContext = systemSourceSchema.parse(
        await readSafeJson(
          await systemContextRoute.GET(
            new Request(`${base}/api/system/context?id=${encodeURIComponent(skillId!)}`),
          ),
        ),
      );

      const conversations = conversationPageSchema.parse(
        await readSafeJson(
          await conversationsRoute.GET(new Request(`${base}/api/conversations?limit=5`)),
        ),
      );
      expect(conversations.items).toHaveLength(5);
      expect(conversations.nextCursor).not.toBeNull();
      const olderConversations = conversationPageSchema.parse(
        await readSafeJson(
          await conversationsRoute.GET(
            new Request(
              `${base}/api/conversations?limit=5&cursor=${encodeURIComponent(conversations.nextCursor!)}`,
            ),
          ),
        ),
      );
      expect(olderConversations.items).toHaveLength(1);
      expect(olderConversations.items[0]?.title).toBe("Synthetic conversation 6");
      expect(olderConversations.nextCursor).toBeNull();

      const conversationId = conversations.items[0]?.id;
      expect(conversationId).toMatch(/^conversation-/u);
      const conversation = conversationSchema.parse(
        await readSafeJson(
          await conversationRoute.GET(
            new Request(`${base}/api/conversations/${encodeURIComponent(conversationId!)}`),
            { params: Promise.resolve({ id: conversationId! }) },
          ),
        ),
      );

      const rootFiles = workspaceDirectorySchema.parse(
        await readSafeJson(await filesRoute.GET(new Request(`${base}/api/files`))),
      );
      const nestedFiles = workspaceDirectorySchema.parse(
        await readSafeJson(await filesRoute.GET(new Request(`${base}/api/files?path=nested`))),
      );
      const file = workspaceFileSchema.parse(
        await readSafeJson(
          await filePreviewRoute.GET(new Request(`${base}/api/files/preview?path=docs%2Fnotes.md`)),
        ),
      );
      const nestedFile = workspaceFileSchema.parse(
        await readSafeJson(
          await filePreviewRoute.GET(
            new Request(`${base}/api/files/preview?path=nested%2Fnotes.md`),
          ),
        ),
      );
      const jobs = jobsSnapshotSchema.parse(
        await readSafeJson(await jobsRoute.GET(new Request(`${base}/api/jobs`))),
      );

      const canonicalHome = realpathSync(fixture.home);
      expect(system.profile.homeLabel).toBe(canonicalHome);
      expect(overview.profile.homeLabel).toBe(canonicalHome);
      expect(system.profile.configState).toBe("ready");
      expect(system.sources).toHaveLength(8);
      expect(system.sources.every((source) => source.stamp.state === "ready")).toBe(true);
      expect(systemContext.content).toContain("bounded-skill-marker");
      expect(conversation.messages.map(({ role }) => role)).toEqual(["user", "tool", "assistant"]);
      expect(rootFiles.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ entryType: "directory", path: "empty" }),
          expect.objectContaining({ entryType: "directory", path: "nested" }),
          expect.objectContaining({ path: "manual.pdf", previewState: "metadata-only" }),
        ]),
      );
      expect(nestedFiles.items).toContainEqual(
        expect.objectContaining({
          path: "nested/notes.md",
          previewState: "available",
        }),
      );
      expect(file.content).toContain("[REDACTED]");
      expect(nestedFile.content).toContain("nested-file-marker");
      expect(jobs).toMatchObject({ definitionsState: "ready", executionsState: "ready" });
      expect(jobs.jobs).toHaveLength(2);
      expect(jobs.jobs[0]).toMatchObject({
        lastStatus: "success",
        schedule: "Daily at 09:00",
      });
      expect(jobs.jobs[0]?.executions).toHaveLength(1);
      expect(jobs.jobs[1]).toMatchObject({
        lastStatus: "failed",
        name: "Synthetic job 2",
        recordedAttempts: 1,
        schedule: "30 14 * * *",
      });
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
        nestedFile,
        nestedFiles,
        olderConversations,
        overview,
        rootFiles,
        system,
        systemContext,
      });
      for (const marker of forbiddenHermesFixtureMarkers) expect(serialized).not.toContain(marker);
      for (const marker of privateHermesFixturePersistenceMarkers)
        expect(serialized).not.toContain(marker);
    } finally {
      assertHermesFixtureSourcesUnchanged(sourceSnapshot);
    }
  });

  it("uses an explicit private manifest without exposing its mapping names", async () => {
    const fixture = createHermesFixture("cockpit-private-manifest-");
    fixtures.push(fixture);
    const privateDatabaseName = "private-conversation-store-marker.sqlite";
    const privateDatabasePath = path.join(fixture.home, privateDatabaseName);
    copyFileSync(fixture.databaseFiles[0]!, privateDatabasePath);
    const database = new Database(privateDatabasePath, { fileMustExist: true });
    database.exec(`
      CREATE VIEW private_session_records_marker AS SELECT * FROM sessions;
      CREATE VIEW private_message_records_marker AS SELECT * FROM messages;
      CREATE VIEW private_prompt_records_marker AS SELECT * FROM system_prompts;
    `);
    database.close();

    const presetManifest = resolveSourceManifest({
      COCKPIT_SOURCE_PRESET: HERMES_SOURCE_PRESET_ID,
    }).manifest;
    const manifestPath = path.join(fixture.root, "private-source-manifest-marker.json");
    writeFileSync(
      manifestPath,
      JSON.stringify({
        ...presetManifest,
        conversation: {
          ...presetManifest.conversation,
          databaseRelativePath: privateDatabaseName,
          messages: {
            ...presetManifest.conversation.messages,
            table: "private_message_records_marker",
          },
          promptTable: "private_prompt_records_marker",
          sessionTable: "private_session_records_marker",
        },
      }),
      "utf8",
    );

    for (const [name, value] of Object.entries(fixture.environment)) vi.stubEnv(name, value);
    vi.stubEnv("COCKPIT_SOURCE_PRESET", "");
    vi.stubEnv("COCKPIT_SOURCE_MANIFEST", manifestPath);
    const sourceSnapshot = snapshotHermesFixtureSources(fixture);
    const base = "http://127.0.0.1:3000";

    try {
      const conversations = conversationPageSchema.parse(
        await readSafeJson(
          await conversationsRoute.GET(new Request(`${base}/api/conversations?limit=5`)),
        ),
      );
      const system = systemSnapshotSchema.parse(
        await readSafeJson(await systemRoute.GET(new Request(`${base}/api/system`))),
      );
      const prompt = system.sources.find((source) => source.id === "prompt");
      expect(conversations.items).toHaveLength(5);
      expect(prompt?.stamp.state).toBe("ready");

      const serialized = JSON.stringify({ conversations, system });
      for (const marker of [
        privateDatabaseName,
        "private_session_records_marker",
        "private_message_records_marker",
        "private_prompt_records_marker",
        path.basename(manifestPath),
      ]) {
        expect(serialized).not.toContain(marker);
      }
    } finally {
      assertHermesFixtureSourcesUnchanged(sourceSnapshot);
    }
  });

  it("exports GET as the only application-defined HTTP method", () => {
    const routes = [
      overviewRoute,
      systemRoute,
      systemContextRoute,
      conversationsRoute,
      conversationRoute,
      filesRoute,
      filePreviewRoute,
      jobsRoute,
    ];

    for (const route of routes) {
      expect(Object.keys(route).filter((key) => httpMethods.has(key))).toEqual(["GET"]);
    }

    expect(routeFiles(path.join(process.cwd(), "src", "app", "api")).sort()).toEqual([
      "agents/[panelId]/conversations/[id]/route.ts",
      "agents/[panelId]/conversations/route.ts",
      "agents/[panelId]/files/preview/route.ts",
      "agents/[panelId]/files/route.ts",
      "agents/[panelId]/jobs/route.ts",
      "agents/[panelId]/overview/route.ts",
      "agents/[panelId]/system/context/route.ts",
      "agents/[panelId]/system/route.ts",
      "conversations/[id]/route.ts",
      "conversations/route.ts",
      "files/preview/route.ts",
      "files/route.ts",
      "jobs/route.ts",
      "overview/route.ts",
      "system/context/route.ts",
      "system/route.ts",
    ]);
  });

  it("classifies only exact regular SQLite sidecar paths as coordination artifacts", () => {
    const fixture = createHermesFixture("cockpit-read-only-guard-");
    fixtures.push(fixture);
    const existingShmPath = `${fixture.databaseFiles[0]}-shm`;
    const createdShmPath = `${fixture.databaseFiles[1]}-shm`;
    writeFileSync(existingShmPath, "baseline coordination", "utf8");
    const sourceSnapshot = snapshotHermesFixtureSources(fixture);
    const walPath = `${fixture.databaseFiles[0]}-wal`;

    writeFileSync(existingShmPath, "updated coordination", "utf8");
    writeFileSync(createdShmPath, "created coordination", "utf8");
    expect(() => assertHermesFixtureSourcesUnchanged(sourceSnapshot)).not.toThrow();

    rmSync(existingShmPath);
    expect(() => assertHermesFixtureSourcesUnchanged(sourceSnapshot)).toThrow(
      /home\/state\.db-shm: removed/u,
    );
    writeFileSync(existingShmPath, "restored coordination", "utf8");

    rmSync(createdShmPath);
    mkdirSync(createdShmPath);
    expect(() => assertHermesFixtureSourcesUnchanged(sourceSnapshot)).toThrow(
      /home\/cron\/executions\.db-shm: not a regular file/u,
    );
    rmSync(createdShmPath, { recursive: true });

    writeFileSync(walPath, "", "utf8");
    expect(() => assertHermesFixtureSourcesUnchanged(sourceSnapshot)).not.toThrow();

    rmSync(walPath);
    mkdirSync(walPath);
    expect(() => assertHermesFixtureSourcesUnchanged(sourceSnapshot)).toThrow(
      /home\/state\.db-wal: not a regular file/u,
    );
    rmSync(walPath, { recursive: true });

    writeFileSync(walPath, "unexpected WAL content", "utf8");
    expect(() => assertHermesFixtureSourcesUnchanged(sourceSnapshot)).toThrow(
      /home\/state\.db-wal: created/u,
    );

    writeFileSync(walPath, "", "utf8");
    writeFileSync(path.join(fixture.workspace, "unexpected-write.tmp"), "mutation", "utf8");
    expect(() => assertHermesFixtureSourcesUnchanged(sourceSnapshot)).toThrow(
      /workspace\/unexpected-write\.tmp: created/u,
    );
  });
});
