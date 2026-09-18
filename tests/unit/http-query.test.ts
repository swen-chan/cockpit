import { describe, expect, it } from "vitest";

import {
  assertNoQuery,
  parseConversationPageQuery,
  parseConversationRequest,
  parseDirectoryQuery,
  parsePreviewQuery,
  parseScopedConversationPageQuery,
  parseScopedConversationRequest,
  parseSkillQuery,
} from "@/server/http/query";

function request(path: string): Request {
  return new Request(`http://127.0.0.1:3000${path}`);
}

describe("HTTP query boundary", () => {
  it("accepts only the documented conversation page parameters", () => {
    expect(parseConversationPageQuery(request("/api/conversations"))).toEqual({
      cursor: null,
      limit: 5,
    });
    expect(
      parseConversationPageQuery(request("/api/conversations?cursor=cursor-Abc_123&limit=25")),
    ).toEqual({ cursor: "cursor-Abc_123", limit: 25 });

    for (const query of [
      "limit=0",
      "limit=1.5",
      "limit=01",
      "limit=26",
      "cursor=forged",
      "limit=5&extra=true",
      "limit=5&limit=6",
    ]) {
      expect(() => parseConversationPageQuery(request(`/api/conversations?${query}`))).toThrowError(
        expect.objectContaining({ code: "invalid_path" }),
      );
    }
  });

  it("validates opaque detail identifiers before service loading", () => {
    expect(
      parseConversationRequest(
        request("/api/conversations/conversation-Abc_123"),
        "conversation-Abc_123",
      ),
    ).toBe("conversation-Abc_123");
    expect(() =>
      parseConversationRequest(
        request("/api/conversations/conversation-Abc_123?extra=true"),
        "conversation-Abc_123",
      ),
    ).toThrowError(expect.objectContaining({ code: "invalid_path" }));
    expect(() =>
      parseConversationRequest(request("/api/conversations/raw-id"), "raw-id"),
    ).toThrowError(expect.objectContaining({ code: "invalid_path" }));

    expect(parseSkillQuery(request("/api/system/context?id=skill-abcdef1234567890abcdef12"))).toBe(
      "skill-abcdef1234567890abcdef12",
    );
    expect(() => parseSkillQuery(request("/api/system/context?id=../SKILL.md"))).toThrowError(
      expect.objectContaining({ code: "invalid_path" }),
    );
  });

  it("accepts only panel-bound scoped history selectors", () => {
    expect(parseScopedConversationPageQuery(request("/api/agents/codex/conversations"))).toEqual({
      cursor: null,
    });
    expect(
      parseScopedConversationPageQuery(
        request("/api/agents/codex/conversations?cursor=cursor-Abc_123"),
      ),
    ).toEqual({ cursor: "cursor-Abc_123" });
    expect(
      parseScopedConversationRequest(
        request("/api/agents/codex/conversations/task-Abc_123"),
        "task-Abc_123",
      ),
    ).toBe("task-Abc_123");

    for (const query of [
      "limit=5",
      "cursor=forged",
      "cursor=cursor-good&cursor=cursor-again",
      `cursor=cursor-${"a".repeat(6_000)}`,
    ]) {
      expect(() =>
        parseScopedConversationPageQuery(request(`/api/agents/codex/conversations?${query}`)),
      ).toThrowError(expect.objectContaining({ code: "invalid_path" }));
    }
    for (const id of ["conversation-Abc_123", "raw-id", `task-${"a".repeat(6_000)}`]) {
      expect(() =>
        parseScopedConversationRequest(request(`/api/agents/codex/conversations/${id}`), id),
      ).toThrowError(expect.objectContaining({ code: "invalid_path" }));
    }
  });

  it("accepts bounded relative workspace paths and rejects traversal or absolute input", () => {
    expect(parseDirectoryQuery(request("/api/files"))).toBe("");
    expect(parseDirectoryQuery(request("/api/files?path=docs%2Fnotes.md"))).toBe("docs/notes.md");
    expect(parsePreviewQuery(request("/api/files/preview?path=docs%2Fnotes.md"))).toBe(
      "docs/notes.md",
    );
    expect(() =>
      parseDirectoryQuery(request("/api/files?path=docs&__proto__=ignored")),
    ).toThrowError(expect.objectContaining({ code: "invalid_path" }));

    for (const path of ["..%252Foutside", "%2Fabsolute", ".env", "docs%2F..%2Foutside"]) {
      expect(() => parsePreviewQuery(request(`/api/files/preview?path=${path}`))).toThrowError(
        expect.objectContaining({ code: expect.any(String) }),
      );
    }
    expect(() => parsePreviewQuery(request("/api/files/preview"))).toThrowError(
      expect.objectContaining({ code: "invalid_path" }),
    );
  });

  it("rejects query input on parameterless endpoints", () => {
    expect(() => assertNoQuery(request("/api/jobs"))).not.toThrow();
    expect(() => assertNoQuery(request("/api/jobs?source=/private/file"))).toThrowError(
      expect.objectContaining({ code: "invalid_path" }),
    );
    for (const specialKey of ["__proto__", "constructor", "toString"]) {
      expect(() => assertNoQuery(request(`/api/jobs?${specialKey}=ignored`))).toThrowError(
        expect.objectContaining({ code: "invalid_path" }),
      );
    }
  });
});
