// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";

import { assertSourceReadAllowed } from "@/server/security/prerender-guard";
import type { CodexPanelDescriptor } from "@/server/panels/registry";
import { loadCodexTaskDetail, loadCodexTaskPage } from "@/server/services/codex-tasks";

const panel: CodexPanelDescriptor = {
  id: "codex",
  name: "Codex",
  runtime: "codex",
  adapterVersion: "codex-0.145.0",
  surfaces: ["overview", "system", "conversations"],
  configuration: { home: "/synthetic/codex-home" },
};

describe("production build source-read guard", () => {
  const original = process.env.COCKPIT_BUILD_SOURCE_READ_GUARD;

  afterEach(() => {
    if (original === undefined) delete process.env.COCKPIT_BUILD_SOURCE_READ_GUARD;
    else process.env.COCKPIT_BUILD_SOURCE_READ_GUARD = original;
  });

  it("stays inert at runtime and fails closed in a guarded build", () => {
    delete process.env.COCKPIT_BUILD_SOURCE_READ_GUARD;
    expect(() => assertSourceReadAllowed()).not.toThrow();

    process.env.COCKPIT_BUILD_SOURCE_READ_GUARD = "1";
    expect(() => assertSourceReadAllowed()).toThrow(/source reader was invoked/u);
  });

  it("guards the public Codex Task list and detail entry points", () => {
    process.env.COCKPIT_BUILD_SOURCE_READ_GUARD = "1";
    expect(() => loadCodexTaskPage(panel)).toThrow(/source reader was invoked/u);
    expect(() => loadCodexTaskDetail(panel, "task-Synthetic")).toThrow(
      /source reader was invoked/u,
    );
  });
});
