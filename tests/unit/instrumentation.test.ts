// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

const reapOwnedTemps = vi.hoisted(() => vi.fn(() => ({ examined: 0, removed: 0 })));
const initializePanelTokenSecret = vi.hoisted(() => vi.fn());

vi.mock("@/server/codex/owned-temp.mjs", () => ({ reapOwnedTemps }));
vi.mock("@/server/panels/opaque-token", () => ({ initializePanelTokenSecret }));

import { register } from "@/instrumentation";

describe("server startup cleanup", () => {
  afterEach(() => {
    initializePanelTokenSecret.mockClear();
    reapOwnedTemps.mockClear();
    vi.unstubAllEnvs();
  });

  it("runs the bounded owned-temp reaper when a Node server instance starts", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    await register();
    expect(initializePanelTokenSecret).toHaveBeenCalledTimes(1);
    expect(reapOwnedTemps).toHaveBeenCalledTimes(1);
    expect(reapOwnedTemps).toHaveBeenCalledWith();
  });

  it("does not import Unix cleanup into an Edge runtime", async () => {
    vi.stubEnv("NEXT_RUNTIME", "edge");
    await register();
    expect(initializePanelTokenSecret).not.toHaveBeenCalled();
    expect(reapOwnedTemps).not.toHaveBeenCalled();
  });
});
