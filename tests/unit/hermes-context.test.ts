import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  resolveHermesContext,
  resolveHermesContextFromEnvironment,
} from "@/server/config/hermes-context";

describe("Hermes context resolution", () => {
  let fixtureRoot = "";
  let platformRoot = "";

  beforeEach(() => {
    fixtureRoot = mkdtempSync(path.join(tmpdir(), "cockpit-context-"));
    platformRoot = path.join(fixtureRoot, "hermes-home");
    mkdirSync(path.join(platformRoot, "profiles", "research"), { recursive: true });
  });

  afterEach(() => rmSync(fixtureRoot, { recursive: true, force: true }));

  it("uses an explicit custom home before environment and sticky sources", () => {
    const explicit = path.join(fixtureRoot, "custom");
    const environment = path.join(fixtureRoot, "environment");
    mkdirSync(explicit);
    mkdirSync(environment);
    const context = resolveHermesContext({
      platformRoot,
      explicitHome: explicit,
      environmentHome: environment,
      stickyProfile: "research",
    });
    expect(context).toMatchObject({
      home: realpathSync(explicit),
      profile: "custom",
      profileKind: "custom",
      source: "explicit",
    });
  });

  it("uses an explicit custom home when the default platform root is absent", () => {
    const explicit = path.join(fixtureRoot, "custom");
    mkdirSync(explicit);
    const context = resolveHermesContext({
      platformRoot: path.join(fixtureRoot, "missing-platform-root"),
      explicitHome: explicit,
    });
    expect(context).toMatchObject({
      home: realpathSync(explicit),
      profile: "custom",
      profileKind: "custom",
      source: "explicit",
    });
  });

  it("resolves default and named sticky profiles", () => {
    expect(resolveHermesContext({ platformRoot, stickyProfile: "default" })).toMatchObject({
      profile: "default",
      profileKind: "default",
      source: "sticky",
    });
    expect(resolveHermesContext({ platformRoot, stickyProfile: "research" })).toMatchObject({
      profile: "research",
      profileKind: "named",
      source: "sticky",
    });
  });

  it("reads HERMES_HOME from the supplied request environment", () => {
    const environmentHome = path.join(fixtureRoot, "environment");
    mkdirSync(environmentHome);
    expect(
      resolveHermesContextFromEnvironment({
        platformRoot,
        environment: { HERMES_HOME: environmentHome },
      }),
    ).toMatchObject({
      home: realpathSync(environmentHome),
      source: "environment",
      profileKind: "custom",
    });
  });

  it("reads the sticky active profile from disk for each environment resolution", () => {
    const activeProfile = path.join(platformRoot, "active_profile");
    writeFileSync(activeProfile, "research\n", "utf8");
    expect(resolveHermesContextFromEnvironment({ platformRoot, environment: {} })).toMatchObject({
      home: realpathSync(path.join(platformRoot, "profiles", "research")),
      profile: "research",
      profileKind: "named",
      source: "sticky",
    });

    writeFileSync(activeProfile, "default\n", "utf8");
    expect(resolveHermesContextFromEnvironment({ platformRoot, environment: {} })).toMatchObject({
      home: realpathSync(platformRoot),
      profile: "default",
      profileKind: "default",
      source: "sticky",
    });
  });

  it("fails closed when the sticky active profile is unavailable", () => {
    writeFileSync(path.join(platformRoot, "active_profile"), "missing\n", "utf8");
    expect(() =>
      resolveHermesContextFromEnvironment({ platformRoot, environment: {} }),
    ).toThrowError(expect.objectContaining({ code: "invalid_profile" }));
  });

  it.each(["../escape", ".hidden", "missing profile"])(
    "rejects invalid profile name %s",
    (profile) => {
      expect(() => resolveHermesContext({ platformRoot, stickyProfile: profile })).toThrowError(
        expect.objectContaining({ code: "invalid_profile" }),
      );
    },
  );

  it("reports a missing named profile without falling back", () => {
    expect(() => resolveHermesContext({ platformRoot, stickyProfile: "missing" })).toThrowError(
      expect.objectContaining({ code: "invalid_profile" }),
    );
  });

  it("rejects a named profile symlink that escapes the canonical profiles root", () => {
    const outside = path.join(fixtureRoot, "outside-profile");
    mkdirSync(outside);
    symlinkSync(outside, path.join(platformRoot, "profiles", "escape"));
    expect(() => resolveHermesContext({ platformRoot, stickyProfile: "escape" })).toThrowError(
      expect.objectContaining({ code: "invalid_profile" }),
    );
  });

  it("rejects a named profile symlink that resolves to a different profile", () => {
    symlinkSync(
      path.join(platformRoot, "profiles", "research"),
      path.join(platformRoot, "profiles", "alias"),
    );
    expect(() => resolveHermesContext({ platformRoot, stickyProfile: "alias" })).toThrowError(
      expect.objectContaining({ code: "invalid_profile" }),
    );
  });
});
