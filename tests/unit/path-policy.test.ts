import { execFileSync } from "node:child_process";
import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { isCredentialFilename } from "@/server/security/credentials";
import { SourceSecurityError } from "@/server/security/errors";
import {
  parseRelativePath,
  resolveApprovedWorkspacePath,
  withExistingWorkspaceFile,
} from "@/server/security/path-policy";

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
    const result = await withExistingWorkspaceFile(
      workspaceRoot,
      "docs/safe%20file.md",
      (file) => ({
        content: readFileSync(file.descriptor, "utf8"),
        relativePath: file.relativePath,
        size: file.size,
      }),
    );
    expect(result).toEqual({ content: "fixture", relativePath: "docs/safe file.md", size: 7 });
  });

  it.each([
    "../outside",
    "docs/../outside",
    "/absolute",
    "docs\\file",
    "docs//file",
    "bad\0file",
    "%2e%2e/outside",
    "%252e%252e/outside",
  ])("rejects invalid or encoded traversal input %s", (candidate) =>
    expect(() => parseRelativePath(candidate)).toThrow(SourceSecurityError),
  );

  it.each([
    ".env",
    ".git/config",
    "docs/auth.json",
    "docs/service-api-key.txt",
    "docs/private.key",
    "docs/service.ppk",
    "docs/AuthKey_ABC123.p8",
    "docs/signing.pk8",
    "docs/github_pat_1234567890abcdef.txt",
    "docs/backup_github_pat_1234567890abcdef.txt",
    "docs/backup_AKIAIOSFODNN7EXAMPLE.txt",
    "docs/sk-proj-1234567890abcdef.md",
    "docs/sk-or-v1-1234567890abcdef.md",
    "docs/backup_sk-proj-1234567890abcdef.txt",
  ])("excludes hidden or credential-like paths %s before opening", (candidate) => {
    try {
      parseRelativePath(candidate);
      throw new Error("expected exclusion");
    } catch (error) {
      expect(error).toMatchObject({ code: "excluded_path" });
    }
  });

  it("blocks a symlink that resolves outside the approved root", async () => {
    const outside = path.join(fixtureRoot, "outside.txt");
    writeFileSync(outside, "private fixture", "utf8");
    symlinkSync(outside, path.join(workspaceRoot, "escape"));
    await expect(
      withExistingWorkspaceFile(workspaceRoot, "escape", () => undefined),
    ).rejects.toThrowError(expect.objectContaining({ code: "path_outside_root" }));
  });

  it.each([".env", "auth.json"])(
    "blocks a safe-looking symlink to excluded in-root target %s",
    async (targetName) => {
      const target = path.join(workspaceRoot, targetName);
      writeFileSync(target, "private fixture", "utf8");
      symlinkSync(target, path.join(workspaceRoot, "safe-looking-link"));
      await expect(
        withExistingWorkspaceFile(workspaceRoot, "safe-looking-link", () => undefined),
      ).rejects.toThrowError(expect.objectContaining({ code: "excluded_path" }));
    },
  );

  it("keeps reading the validated object when its path is replaced after opening", async () => {
    const safePath = path.join(workspaceRoot, "docs", "safe file.md");
    const movedPath = path.join(workspaceRoot, "docs", "original.md");
    const outside = path.join(fixtureRoot, "outside.txt");
    writeFileSync(outside, "private fixture", "utf8");

    const content = await withExistingWorkspaceFile(
      workspaceRoot,
      "docs/safe%20file.md",
      (file) => {
        renameSync(safePath, movedPath);
        symlinkSync(outside, safePath);
        return readFileSync(file.descriptor, "utf8");
      },
    );

    expect(content).toBe("fixture");
  });

  it("keeps the descriptor open until an asynchronous reader finishes", async () => {
    const content = await withExistingWorkspaceFile(
      workspaceRoot,
      "docs/safe%20file.md",
      async (file) => {
        await Promise.resolve();
        return readFileSync(file.descriptor, "utf8");
      },
    );

    expect(content).toBe("fixture");
  });

  it("does not misclassify an unreadable existing file as a missing source", async () => {
    const candidate = path.join(workspaceRoot, "docs", "unreadable.md");
    writeFileSync(candidate, "private fixture");
    chmodSync(candidate, 0o000);
    try {
      await expect(
        withExistingWorkspaceFile(workspaceRoot, "docs/unreadable.md", () => undefined),
      ).rejects.toMatchObject({ code: "source_unavailable" });
    } finally {
      chmodSync(candidate, 0o600);
    }
  });

  it("rejects a named pipe without opening a blocking read descriptor", async () => {
    const fifo = path.join(workspaceRoot, "docs", "blocking-source.md");
    execFileSync("mkfifo", [fifo]);
    const anchor = openSync(fifo, constants.O_RDWR | constants.O_NONBLOCK);

    try {
      expect(() =>
        resolveApprovedWorkspacePath(workspaceRoot, fifo, { kind: "file" }),
      ).toThrowError(expect.objectContaining({ code: "source_unavailable" }));
      await expect(
        withExistingWorkspaceFile(workspaceRoot, "docs/blocking-source.md", () => undefined),
      ).rejects.toMatchObject({ code: "source_unavailable" });
    } finally {
      closeSync(anchor);
    }
  });

  it("resolves protocol paths to canonical workspace-relative paths", () => {
    const absoluteFile = path.join(workspaceRoot, "docs", "safe file.md");
    const canonicalRoot = realpathSync(workspaceRoot);
    const canonicalFile = realpathSync(absoluteFile);
    expect(resolveApprovedWorkspacePath(workspaceRoot, absoluteFile, { kind: "file" })).toEqual({
      absolutePath: canonicalFile,
      relativePath: "docs/safe file.md",
    });
    expect(
      resolveApprovedWorkspacePath(workspaceRoot, "safe file.md", {
        base: path.join(workspaceRoot, "docs"),
        kind: "any",
      }),
    ).toEqual({
      absolutePath: canonicalFile,
      relativePath: "docs/safe file.md",
    });
    expect(
      resolveApprovedWorkspacePath(workspaceRoot, `${workspaceRoot}/`, { kind: "directory" }),
    ).toEqual({
      absolutePath: canonicalRoot,
      relativePath: "",
    });
  });

  it("keeps encoded-looking protocol filenames literal instead of URL-decoding them", () => {
    mkdirSync(path.join(workspaceRoot, "%2e%2e"));
    writeFileSync(path.join(workspaceRoot, "%2e%2e", "literal.txt"), "literal");

    expect(
      resolveApprovedWorkspacePath(workspaceRoot, "%2e%2e/literal.txt", {
        base: workspaceRoot,
        kind: "file",
      }).relativePath,
    ).toBe("%2e%2e/literal.txt");
  });

  it("returns the canonical in-root target of a symlink and rejects unsafe targets", () => {
    symlinkSync(
      path.join(workspaceRoot, "docs", "safe file.md"),
      path.join(workspaceRoot, "safe-alias.md"),
    );
    expect(
      resolveApprovedWorkspacePath(workspaceRoot, "safe-alias.md", {
        base: workspaceRoot,
        kind: "file",
      }).relativePath,
    ).toBe("docs/safe file.md");

    const outside = path.join(fixtureRoot, "outside-protocol.txt");
    writeFileSync(outside, "outside");
    symlinkSync(outside, path.join(workspaceRoot, "outside-alias.md"));
    expect(() =>
      resolveApprovedWorkspacePath(workspaceRoot, "outside-alias.md", {
        base: workspaceRoot,
        kind: "file",
      }),
    ).toThrowError(expect.objectContaining({ code: "path_outside_root" }));

    writeFileSync(path.join(workspaceRoot, "auth.json"), "secret");
    symlinkSync(
      path.join(workspaceRoot, "auth.json"),
      path.join(workspaceRoot, "credential-alias.md"),
    );
    expect(() =>
      resolveApprovedWorkspacePath(workspaceRoot, "credential-alias.md", {
        base: workspaceRoot,
        kind: "file",
      }),
    ).toThrowError(expect.objectContaining({ code: "excluded_path" }));
  });

  it.each(["unsafe\nname.txt", "unsafe\u202ename.txt", "unsafe\\name.txt"])(
    "rejects a safe-looking alias whose canonical target has unsafe text %s",
    (targetName) => {
      const target = path.join(workspaceRoot, targetName);
      writeFileSync(target, "unsafe name");
      const alias = path.join(
        workspaceRoot,
        `alias-${Buffer.from(targetName).toString("hex")}.txt`,
      );
      symlinkSync(target, alias);

      expect(() =>
        resolveApprovedWorkspacePath(workspaceRoot, alias, { kind: "file" }),
      ).toThrowError(expect.objectContaining({ code: "invalid_path" }));
    },
  );

  it("requires an absolute, existing, approved directory base for relative protocol paths", () => {
    const outsideDirectory = path.join(fixtureRoot, "outside-directory");
    mkdirSync(outsideDirectory);
    writeFileSync(path.join(outsideDirectory, "outside.txt"), "outside");

    expect(() =>
      resolveApprovedWorkspacePath(workspaceRoot, "docs/safe file.md", { kind: "file" }),
    ).toThrowError(expect.objectContaining({ code: "invalid_path" }));
    expect(() =>
      resolveApprovedWorkspacePath(workspaceRoot, "safe file.md", { base: "docs", kind: "file" }),
    ).toThrowError(expect.objectContaining({ code: "invalid_path" }));
    expect(() =>
      resolveApprovedWorkspacePath(workspaceRoot, "outside.txt", {
        base: outsideDirectory,
        kind: "file",
      }),
    ).toThrowError(expect.objectContaining({ code: "path_outside_root" }));
  });

  it.each([
    "docs/../outside.txt",
    "docs\\safe.txt",
    "docs//safe.txt",
    "docs/control\u0007.txt",
    "docs/bidi\u202etxt.md",
    "docs/lone\ud800.txt",
    ".git/config",
    "docs/auth.json",
  ])("rejects unsafe raw protocol path %s", (candidate) => {
    expect(() =>
      resolveApprovedWorkspacePath(workspaceRoot, candidate, {
        base: workspaceRoot,
        kind: "file",
        allowMissing: true,
      }),
    ).toThrow(SourceSecurityError);
  });

  it("proves a missing add or delete path through its nearest existing directory without creating it", () => {
    const result = resolveApprovedWorkspacePath(workspaceRoot, "new/deep/file.ts", {
      base: path.join(workspaceRoot, "docs"),
      kind: "file",
      allowMissing: true,
    });

    expect(result).toEqual({
      absolutePath: path.join(realpathSync(workspaceRoot), "docs", "new", "deep", "file.ts"),
      relativePath: "docs/new/deep/file.ts",
    });
    expect(existsSync(result.absolutePath)).toBe(false);
    expect(existsSync(path.join(workspaceRoot, "docs", "new"))).toBe(false);
  });

  it("does not treat a dangling symlink or a wrong existing kind as an approved missing file", () => {
    symlinkSync(
      path.join(workspaceRoot, "missing-target.txt"),
      path.join(workspaceRoot, "dangling.txt"),
    );

    expect(() =>
      resolveApprovedWorkspacePath(workspaceRoot, "dangling.txt", {
        base: workspaceRoot,
        kind: "file",
        allowMissing: true,
      }),
    ).toThrowError(expect.objectContaining({ code: "missing_source" }));
    expect(() =>
      resolveApprovedWorkspacePath(workspaceRoot, "docs", {
        base: workspaceRoot,
        kind: "file",
        allowMissing: true,
      }),
    ).toThrowError(expect.objectContaining({ code: "missing_source" }));
  });

  it("rejects missing absolute paths whose nearest existing ancestor is outside the approved root", () => {
    expect(() =>
      resolveApprovedWorkspacePath(
        workspaceRoot,
        path.join(fixtureRoot, "outside-new", "file.ts"),
        { kind: "file", allowMissing: true },
      ),
    ).toThrowError(expect.objectContaining({ code: "path_outside_root" }));
  });

  it("normalizes asynchronous reader failures", async () => {
    await expect(
      withExistingWorkspaceFile(workspaceRoot, "docs/safe%20file.md", async () => {
        await Promise.resolve();
        throw new Error("private fixture detail");
      }),
    ).rejects.toMatchObject({ code: "source_unavailable" });
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
