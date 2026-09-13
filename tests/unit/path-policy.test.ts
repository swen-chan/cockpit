import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { isCredentialFilename } from "@/server/security/credentials";
import { SourceSecurityError } from "@/server/security/errors";
import { parseRelativePath, withExistingWorkspaceFile } from "@/server/security/path-policy";

describe("approved workspace path policy", () => {
  let fixtureRoot = "";
  let workspaceRoot = "";

  beforeEach(() => {
    fixtureRoot = mkdtempSync(path.join(tmpdir(), "cockpit-path-policy-"));
    workspaceRoot = path.join(fixtureRoot, "workspace");
    mkdirSync(path.join(workspaceRoot, "docs"), { recursive: true });
    writeFileSync(path.join(workspaceRoot, "docs", "safe file.md"), "fixture", "utf8");
  });

  afterEach(() => rmSync(fixtureRoot, { recursive: true, force: true }));

  it("opens and reads an existing allowed relative path through one pinned descriptor", async () => {
    const result = await withExistingWorkspaceFile(workspaceRoot, "docs/safe%20file.md", (file) => ({
      content: readFileSync(file.descriptor, "utf8"),
      relativePath: file.relativePath,
      size: file.size,
    }));
    expect(result).toEqual({ content: "fixture", relativePath: "docs/safe file.md", size: 7 });
  });

  it.each(["../outside", "docs/../outside", "/absolute", "docs\\file", "docs//file", "bad\0file", "%2e%2e/outside", "%252e%252e/outside"])(
    "rejects invalid or encoded traversal input %s",
    (candidate) => expect(() => parseRelativePath(candidate)).toThrow(SourceSecurityError),
  );

  it.each([".env", ".git/config", "docs/auth.json", "docs/service-api-key.txt", "docs/private.key", "docs/service.ppk", "docs/AuthKey_ABC123.p8", "docs/signing.pk8", "docs/github_pat_1234567890abcdef.txt", "docs/backup_github_pat_1234567890abcdef.txt", "docs/backup_AKIAIOSFODNN7EXAMPLE.txt", "docs/sk-proj-1234567890abcdef.md", "docs/sk-or-v1-1234567890abcdef.md", "docs/backup_sk-proj-1234567890abcdef.txt"])(
    "excludes hidden or credential-like paths %s before opening",
    (candidate) => {
      try {
        parseRelativePath(candidate);
        throw new Error("expected exclusion");
      } catch (error) {
        expect(error).toMatchObject({ code: "excluded_path" });
      }
    },
  );

  it("blocks a symlink that resolves outside the approved root", async () => {
    const outside = path.join(fixtureRoot, "outside.txt");
    writeFileSync(outside, "private fixture", "utf8");
    symlinkSync(outside, path.join(workspaceRoot, "escape"));
    await expect(withExistingWorkspaceFile(workspaceRoot, "escape", () => undefined)).rejects.toThrowError(
      expect.objectContaining({ code: "path_outside_root" }),
    );
  });

  it.each([".env", "auth.json"])("blocks a safe-looking symlink to excluded in-root target %s", async (targetName) => {
    const target = path.join(workspaceRoot, targetName);
    writeFileSync(target, "private fixture", "utf8");
    symlinkSync(target, path.join(workspaceRoot, "safe-looking-link"));
    await expect(withExistingWorkspaceFile(workspaceRoot, "safe-looking-link", () => undefined)).rejects.toThrowError(
      expect.objectContaining({ code: "excluded_path" }),
    );
  });

  it("keeps reading the validated object when its path is replaced after opening", async () => {
    const safePath = path.join(workspaceRoot, "docs", "safe file.md");
    const movedPath = path.join(workspaceRoot, "docs", "original.md");
    const outside = path.join(fixtureRoot, "outside.txt");
    writeFileSync(outside, "private fixture", "utf8");

    const content = await withExistingWorkspaceFile(workspaceRoot, "docs/safe%20file.md", (file) => {
      renameSync(safePath, movedPath);
      symlinkSync(outside, safePath);
      return readFileSync(file.descriptor, "utf8");
    });

    expect(content).toBe("fixture");
  });

  it("keeps the descriptor open until an asynchronous reader finishes", async () => {
    const content = await withExistingWorkspaceFile(workspaceRoot, "docs/safe%20file.md", async (file) => {
      await Promise.resolve();
      return readFileSync(file.descriptor, "utf8");
    });

    expect(content).toBe("fixture");
  });

  it("normalizes asynchronous reader failures", async () => {
    await expect(withExistingWorkspaceFile(workspaceRoot, "docs/safe%20file.md", async () => {
      await Promise.resolve();
      throw new Error("private fixture detail");
    })).rejects.toMatchObject({ code: "source_unavailable" });
  });

  it("recognizes credential filenames without matching ordinary names", () => {
    expect(isCredentialFilename("oauth-token.json")).toBe(true);
    expect(isCredentialFilename("signing.PEM")).toBe(true);
    expect(isCredentialFilename("id_rsa.bak")).toBe(true);
    expect(isCredentialFilename("id_ed25519.backup")).toBe(true);
    expect(isCredentialFilename("server.pem.bak")).toBe(true);
    expect(isCredentialFilename("service.ppk")).toBe(true);
    expect(isCredentialFilename("service.ppk.backup")).toBe(true);
    expect(isCredentialFilename("AuthKey_ABC123.p8")).toBe(true);
    expect(isCredentialFilename("signing.pk8.bak")).toBe(true);
    expect(isCredentialFilename("credentials.json.old")).toBe(true);
    expect(isCredentialFilename("id_dsa")).toBe(true);
    expect(isCredentialFilename("id_ecdsa.backup")).toBe(true);
    expect(isCredentialFilename("id_ecdsa_sk.bak")).toBe(true);
    expect(isCredentialFilename("id_ed25519_sk.old")).toBe(true);
    expect(isCredentialFilename("github_pat_1234567890abcdef.txt")).toBe(true);
    expect(isCredentialFilename("backup_github_pat_1234567890abcdef.txt")).toBe(true);
    expect(isCredentialFilename("backup_AKIAIOSFODNN7EXAMPLE.txt")).toBe(true);
    expect(isCredentialFilename("sk-proj-1234567890abcdef.md.backup")).toBe(true);
    expect(isCredentialFilename("sk-or-v1-1234567890abcdef.md")).toBe(true);
    expect(isCredentialFilename("backup_sk-proj-1234567890abcdef.txt")).toBe(true);
    expect(isCredentialFilename("AKIAIOSFODNN7EXAMPLE.txt")).toBe(true);
    expect(isCredentialFilename("monkey-notes.md")).toBe(false);
    expect(isCredentialFilename("authentication-guide.md")).toBe(false);
    expect(isCredentialFilename("github-patterns.md")).toBe(false);
    expect(isCredentialFilename("sk-project-roadmap.md")).toBe(false);
    expect(isCredentialFilename("sk-local-notes.md")).toBe(false);
    expect(isCredentialFilename("sketch-project-roadmap.md")).toBe(false);
    expect(isCredentialFilename("tokenization-notes.md")).toBe(false);
  });
});
