// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { codexSystemSnapshotSchema } from "@/contracts/codex";
import type { CodexPanelDescriptor } from "@/server/panels/registry";
import { resolvePanel, resolvePanelRegistry } from "@/server/panels/registry";
import { SourceSecurityError } from "@/server/security/errors";
import { createCodexSystemServiceForTest } from "@/server/services/codex-system";

function panel(): CodexPanelDescriptor {
  const resolved = resolvePanel(
    resolvePanelRegistry({
      COCKPIT_CODEX_HOME: "/synthetic/codex",
      COCKPIT_CODEX_WORKSPACE_ROOT: "/synthetic/workspace",
      COCKPIT_CODEX_CUSTOM_GUIDANCE: "SOUL.md",
    }),
    "codex",
  );
  if (resolved.runtime !== "codex") throw new Error("synthetic panel mismatch");
  return resolved;
}

const sources = [
  {
    key: "global-guidance" as const,
    label: "Global guidance" as const,
    origin: "Codex home" as const,
    state: "ready" as const,
    content: "synthetic guidance",
    truncated: false,
  },
];

describe("Codex System service", () => {
  it("settles one standalone runtime probe alongside current guidance", async () => {
    const probe = vi.fn(async () => ({ version: "0.145.0" as const }));
    const guidance = vi.fn(async () => sources);
    const load = createCodexSystemServiceForTest({ reader: { probe }, guidance });

    const snapshot = await load(panel(), { now: new Date("2026-09-16T07:00:00.000Z") });

    expect(probe).toHaveBeenCalledOnce();
    expect(guidance).toHaveBeenCalledOnce();
    expect(snapshot).toEqual({
      runtime: { label: "Codex CLI", state: "ready", version: "0.145.0" },
      sources,
      observedAt: "2026-09-16T07:00:00.000Z",
    });
    expect(codexSystemSnapshotSchema.safeParse(snapshot).success).toBe(true);
  });

  it("keeps guidance visible when the runtime probe is unavailable", async () => {
    const load = createCodexSystemServiceForTest({
      reader: {
        probe: vi.fn(async () => {
          throw new SourceSecurityError("missing_source");
        }),
      },
      guidance: vi.fn(async () => sources),
    });

    const snapshot = await load(panel(), { now: new Date("2026-09-16T07:00:00.000Z") });

    expect(snapshot.runtime).toEqual({
      label: "Codex CLI",
      state: "unavailable",
      message: "The requested local source is unavailable.",
    });
    expect(snapshot.sources).toEqual(sources);
  });

  it("localizes an unexpected guidance-reader failure without hiding runtime", async () => {
    const load = createCodexSystemServiceForTest({
      reader: { probe: vi.fn(async () => ({ version: "0.145.0" as const })) },
      guidance: vi.fn(async () => {
        throw new Error("private synthetic detail");
      }),
    });

    const snapshot = await load(panel(), { now: new Date("2026-09-16T07:00:00.000Z") });

    expect(snapshot.runtime.state).toBe("ready");
    expect(snapshot.sources).toEqual([
      expect.objectContaining({ key: "global-guidance", state: "error" }),
      expect.objectContaining({ key: "workspace-guidance", state: "error" }),
      expect.objectContaining({ key: "custom-guidance", state: "error" }),
    ]);
    expect(JSON.stringify(snapshot)).not.toContain("private synthetic detail");
  });
});
