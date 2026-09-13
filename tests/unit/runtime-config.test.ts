import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { resolveCockpitRuntimeConfig } from "@/server/config/runtime";

describe("Cockpit runtime configuration", () => {
  const fixtureRoots: string[] = [];

  afterEach(() => {
    for (const root of fixtureRoots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it("requires and canonicalizes the approved workspace root", () => {
    const fixtureRoot = mkdtempSync(path.join(tmpdir(), "cockpit-runtime-"));
    fixtureRoots.push(fixtureRoot);
    const workspace = path.join(fixtureRoot, "workspace");
    mkdirSync(workspace);
    expect(resolveCockpitRuntimeConfig({ COCKPIT_WORKSPACE_ROOT: workspace })).toEqual({
      workspaceRoot: realpathSync(workspace),
    });
  });

  it("fails closed when no workspace root is configured", () => {
    expect(() => resolveCockpitRuntimeConfig({})).toThrowError(expect.objectContaining({ code: "missing_source" }));
  });
});
