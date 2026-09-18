import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { workspaceDirectorySchema, workspaceFileSchema } from "@/contracts/source-result";
import { readWorkspaceDirectory, readWorkspacePreview } from "@/server/adapters/files";
import { SOURCE_LIMITS } from "@/server/security/limits";

describe("workspace files adapter", () => {
  let fixtureRoot = "";
  let workspaceRoot = "";

  beforeEach(() => {
    fixtureRoot = mkdtempSync(path.join(tmpdir(), "cockpit-files-"));
    workspaceRoot = path.join(fixtureRoot, "workspace");
    mkdirSync(path.join(workspaceRoot, "docs"), { recursive: true });
    writeFileSync(
      path.join(workspaceRoot, "notes.md"),
      [
        "# Notes",
        "Read /Users/private/work.",
        "token=secret-example-value",
        "https://alice:swordfish@example.invalid/path",
        "https://example.invalid/?%61ccess_token=encoded-secret",
        "/root/private-agent",
        "/private/tmp/private-agent",
        "marker </root/html-private-agent> and </private/tmp/html-private-agent>",
        String.raw`\\private-server\private-share\private-agent`,
        "\u001b[31mterminal-control\u001b[0m",
        "direction\u202ereversed",
      ].join("\n"),
    );
    writeFileSync(path.join(workspaceRoot, "index.html"), "<script>window.pwned = true</script>");
    writeFileSync(path.join(workspaceRoot, "binary.txt"), Buffer.from([0x61, 0x00, 0x62]));
    writeFileSync(path.join(workspaceRoot, "manual.pdf"), "%PDF fixture");
    writeFileSync(
      path.join(workspaceRoot, "large.md"),
      "x".repeat(SOURCE_LIMITS.maxPreviewBytes + 1),
    );
    writeFileSync(path.join(workspaceRoot, ".hidden"), "hidden");
    writeFileSync(path.join(workspaceRoot, "auth.json"), "secret");
    writeFileSync(path.join(workspaceRoot, "github_pat_1234567890abcdef.txt"), "secret");
    mkdirSync(path.join(workspaceRoot, "private-token"));
    writeFileSync(path.join(workspaceRoot, "private-token", "safe.txt"), "secret");
    mkdirSync(path.join(workspaceRoot, "sk-proj-1234567890abcdef"));
    writeFileSync(path.join(workspaceRoot, "sk-proj-1234567890abcdef", "safe.txt"), "secret");
    const outside = path.join(fixtureRoot, "outside.txt");
    writeFileSync(outside, "outside");
    symlinkSync(outside, path.join(workspaceRoot, "escape.txt"));
  });

  afterEach(() => rmSync(fixtureRoot, { recursive: true, force: true }));

  it("returns a bounded, sorted, browser-safe directory listing", async () => {
    const directory = await readWorkspaceDirectory(
      workspaceRoot,
      "",
      new Date("2026-09-08T00:00:00Z"),
    );

    expect(workspaceDirectorySchema.safeParse(directory).success).toBe(true);
    expect(directory.path).toBe("");
    expect(directory.parentPath).toBeNull();
    expect(directory.items.map((entry) => entry.name)).toEqual([
      "binary.txt",
      "docs",
      "index.html",
      "large.md",
      "manual.pdf",
      "notes.md",
    ]);
    expect(JSON.stringify(directory)).not.toContain(fixtureRoot);
    expect(JSON.stringify(directory)).not.toContain("auth.json");
    expect(JSON.stringify(directory)).not.toContain("private-token");
    expect(JSON.stringify(directory)).not.toContain("github_pat_");
    expect(JSON.stringify(directory)).not.toContain("sk-proj-");
    expect(JSON.stringify(directory)).not.toContain("escape.txt");
  });

  it("reads supported text through bounded previews and redacts sensitive text", async () => {
    const preview = await readWorkspacePreview(workspaceRoot, "notes.md");

    expect(workspaceFileSchema.safeParse(preview).success).toBe(true);
    expect(preview.previewState).toBe("available");
    expect(preview.content).toContain("# Notes");
    expect(preview.content).toContain("<local-path>");
    expect(preview.content).toContain("[REDACTED]");
    expect(JSON.stringify(preview)).not.toContain(fixtureRoot);
    expect(JSON.stringify(preview)).not.toContain("secret-example-value");
    for (const privateFragment of [
      "swordfish",
      "encoded-secret",
      "/root/private-agent",
      "/private/tmp/private-agent",
      "html-private-agent",
      "private-server",
      "private-share",
      "\u001b",
      "\u202e",
    ])
      expect(JSON.stringify(preview)).not.toContain(privateFragment);
  });

  it("fails a preview closed when a credential-shaped residual cannot be tokenized", async () => {
    writeFileSync(
      path.join(workspaceRoot, "residual.md"),
      "private.example.test/callback?%61ccess%5Ftoken=encoded-secret",
    );

    const preview = await readWorkspacePreview(workspaceRoot, "residual.md");

    expect(workspaceFileSchema.safeParse(preview).success).toBe(true);
    expect(preview).toMatchObject({ previewState: "available", content: "[REDACTED]" });
    expect(JSON.stringify(preview)).not.toContain("encoded-secret");
  });

  it("redacts each credential-bearing endpoint inside mixed preview text", async () => {
    writeFileSync(
      path.join(workspaceRoot, "mixed-endpoints.md"),
      [
        "first?x=1",
        "private.example.test/callback?%61ccess%5Ftoken=encoded-secret",
        "see (https://alice:paren-secret@example.invalid/path)",
        "[db](https://bob:markdown-secret@example.invalid/path)",
        "see (//carol:relative-secret@example.invalid/path)",
        "safe suffix",
      ].join("\n"),
    );

    const preview = await readWorkspacePreview(workspaceRoot, "mixed-endpoints.md");

    expect(preview.content).toContain("first?x=1");
    expect(preview.content).toContain("[REDACTED]");
    expect(preview.content).toContain("safe suffix");
    for (const secret of ["encoded-secret", "paren-secret", "markdown-secret", "relative-secret"])
      expect(preview.content).not.toContain(secret);
  });

  it("keeps HTML as inert source text and rejects binary or oversized previews", async () => {
    const html = await readWorkspacePreview(workspaceRoot, "index.html");
    const binary = await readWorkspacePreview(workspaceRoot, "binary.txt");
    const oversized = await readWorkspacePreview(workspaceRoot, "large.md");

    expect(html.kind).toBe("HTML source");
    expect(html.content).toBe("<script>window.pwned = true</script>");
    expect(binary).not.toHaveProperty("content");
    expect(binary.previewState).toBe("metadata-only");
    expect(oversized).not.toHaveProperty("content");
    expect(oversized.previewState).toBe("metadata-only");
  });

  it("caps large directories at 500 visible rows", async () => {
    const many = path.join(workspaceRoot, "many");
    mkdirSync(many);
    for (let index = 0; index < SOURCE_LIMITS.maxDirectoryEntries + 2; index += 1) {
      writeFileSync(path.join(many, `item-${String(index).padStart(3, "0")}.txt`), "fixture");
    }

    const directory = await readWorkspaceDirectory(workspaceRoot, "many");
    expect(directory.items).toHaveLength(SOURCE_LIMITS.maxDirectoryEntries);
    expect(directory.truncated).toBe(true);
    expect(directory.parentPath).toBe("");
  });

  it("reads a fresh version after a file changes without retaining a snapshot", async () => {
    const first = await readWorkspaceDirectory(workspaceRoot, "");
    const listed = first.items.find((entry) => entry.name === "notes.md");
    writeFileSync(path.join(workspaceRoot, "notes.md"), "# Updated\n");

    const preview = await readWorkspacePreview(workspaceRoot, listed!.path);
    expect(preview.content).toBe("# Updated\n");
    expect(preview.sizeBytes).toBe(10);
  });

  it.each([
    "../outside.txt",
    "%2e%2e/outside.txt",
    "/absolute.txt",
    ".env",
    "auth.json",
    "github_pat_1234567890abcdef.txt",
    "sk-proj-1234567890abcdef/safe.txt",
  ])("rejects an invalid or excluded preview path %s", async (candidate) => {
    await expect(readWorkspacePreview(workspaceRoot, candidate)).rejects.toMatchObject({
      code: expect.stringMatching(/invalid_path|excluded_path/u),
    });
  });

  it("blocks direct preview of an escaping symlink", async () => {
    await expect(readWorkspacePreview(workspaceRoot, "escape.txt")).rejects.toMatchObject({
      code: "path_outside_root",
    });
  });
});
