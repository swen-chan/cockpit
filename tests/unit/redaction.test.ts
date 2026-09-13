import { describe, expect, it } from "vitest";

import {
  containsSecrets,
  redactBrowserText,
  redactMachinePaths,
  redactSecrets,
} from "@/server/security/redaction";

describe("browser boundary redaction", () => {
  it("redacts sensitive keys recursively across arrays and casing", () => {
    const result = redactSecrets({
      safe: "visible",
      nested: [{ API_Key: "private" }, { clientSecret: "private" }],
      Authorization: "Bearer private-value",
    });
    expect(result).toEqual({
      safe: "visible",
      nested: [{ API_Key: "[REDACTED]" }, { clientSecret: "[REDACTED]" }],
      Authorization: "[REDACTED]",
    });
  });

  it.each(["sshPassphrase", "key_passphrase", "pass-phrase"])(
    "redacts passphrase field %s",
    (key) => expect(redactSecrets({ [key]: "private fixture" })).toEqual({ [key]: "[REDACTED]" }),
  );

  it("redacts credential-like values even under an innocuous key", () => {
    const syntheticCredential = `Bearer ${"a".repeat(16)}`;
    expect(redactSecrets({ note: `use ${syntheticCredential}` })).toEqual({ note: "use [REDACTED]" });
  });

  it("redacts hyphenated sk credentials under an innocuous key", () => {
    const syntheticCredential = `sk-proj-${"a".repeat(16)}`;
    expect(redactSecrets({ note: `use ${syntheticCredential}` })).toEqual({ note: "use [REDACTED]" });
    expect(redactSecrets({ note: `use sk-${"a1".repeat(10)}` })).toEqual({ note: "use [REDACTED]" });
    expect(redactSecrets({ note: `use sk-or-v1-${"a1".repeat(10)}` })).toEqual({ note: "use [REDACTED]" });
    expect(redactSecrets({ note: `use backup_sk-proj-${"a1".repeat(10)}` }))
      .toEqual({ note: "use backup_[REDACTED]" });
  });

  it.each(["ghp_", "gho_", "ghu_", "ghs_", "ghr_", "github_pat_"])(
    "redacts %s GitHub tokens under an innocuous key",
    (prefix) => {
      const syntheticCredential = `${prefix}${"a1".repeat(8)}`;
      expect(redactSecrets({ note: `use ${syntheticCredential}` })).toEqual({ note: "use [REDACTED]" });
    },
  );

  it("detects strong credentials after filename separators", () => {
    expect(redactSecrets(`backup_github_pat_${"a1".repeat(8)}.txt`))
      .toBe("backup_[REDACTED].txt");
    expect(redactSecrets(`backup_AKIA${"A1".repeat(8)}.txt`))
      .toBe("backup_[REDACTED].txt");
    expect(redactSecrets(`backup_AIza${"a".repeat(34)}_.txt`))
      .toBe("backup_[REDACTED].txt");
  });

  it.each(["AKIA", "ASIA"])("redacts %s AWS access key IDs under an innocuous key", (prefix) => {
    const syntheticCredential = `${prefix}${"A1".repeat(8)}`;
    expect(redactSecrets({ note: `use ${syntheticCredential}` })).toEqual({ note: "use [REDACTED]" });
  });

  it("redacts a bounded Google API key under an innocuous key", () => {
    const syntheticCredential = `AIza${"a".repeat(34)}_`;
    expect(redactSecrets({ note: `use ${syntheticCredential}` })).toEqual({ note: "use [REDACTED]" });
    expect(redactSecrets({ note: `use AIza${"a".repeat(34)}` })).toEqual({ note: `use AIza${"a".repeat(34)}` });
  });

  it("redacts an unprefixed compact JWT under an innocuous key", () => {
    const syntheticCredential = `eyJ${"a".repeat(12)}.${"b".repeat(16)}.${"c".repeat(19)}_`;
    expect(redactSecrets({ note: `use ${syntheticCredential}` })).toEqual({ note: "use [REDACTED]" });
  });

  it("handles cyclic objects without leaking or recursing forever", () => {
    const fixture: Record<string, unknown> = {};
    fixture.self = fixture;
    expect(redactSecrets(fixture)).toEqual({ self: "[REDACTED:CIRCULAR]" });
  });

  it.each([
    "postgres://alice:s3cr3t@db.internal/jobs",
    "//alice:s3cr3t@db.internal/jobs",
    "https://internal/callback?access_token=query-secret",
    "private.example.test/callback?%61ccess_token=encoded-secret",
    "https://internal/callback#access_token=fragment-secret",
    "https://internal/#/callback?refresh_token=fragment-secret",
    "private.example.test/callback?access_token=schemeless-secret",
    "//private.example.test/callback?access_token=relative-secret",
    "access_token=plain-secret",
  ])("detects credentials across endpoint forms in %s", (value) => {
    expect(containsSecrets(value)).toBe(true);
  });

  it.each([
    "https://private.example.test/callback",
    "private.example.test:8443/callback",
    "localhost:9000/admin",
    "[fd00::1]:8443/private",
    "/Users/private-name/project",
    "C:\\Users\\private-name\\project",
    "0 14 * * *",
    "token economics discussion",
    "sk-project-roadmap.md",
    "sk-local-notes.md",
  ])("keeps non-credential references visible in %s", (value) => {
    expect(containsSecrets(value)).toBe(false);
  });
});

describe("machine path redaction", () => {
  it.each([
    ["Open /Users/private-name/AI/Hermes/file.md now", "Open <local-path> now"],
    ["Read /home/private-name/work/file.txt", "Read <local-path>"],
    ["Use C:\\Users\\private-name\\Hermes\\SOUL.md", "Use <local-path>"],
  ])("redacts a user-home path in %s", (input, expected) => {
    expect(redactMachinePaths(input)).toBe(expected);
  });

  it("does not alter web URLs or safe relative paths", () => {
    expect(redactMachinePaths("https://example.com/Users/docs and docs/file.md"))
      .toBe("https://example.com/Users/docs and docs/file.md");
  });
});

describe("browser text redaction", () => {
  it("redacts credential assignments embedded in document text", () => {
    expect(redactBrowserText("api_key: ordinary-looking-private-value\nSafe line"))
      .toBe("[REDACTED]\nSafe line");
    expect(redactBrowserText("password = 'private words'"))
      .toBe("[REDACTED]");
  });
});
