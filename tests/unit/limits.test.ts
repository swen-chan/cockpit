import { describe, expect, it } from "vitest";

import { boundUtf8Text } from "@/server/security/limits";

describe("source content limits", () => {
  it("bounds text by bytes without returning a broken UTF-8 suffix", () => {
    const result = boundUtf8Text("safe你好tail", 8, 100);
    expect(result.text).toBe("safe你");
    expect(result.truncated).toBe(true);
  });

  it("bounds text by Unicode characters", () => {
    const result = boundUtf8Text("a😀bc", 100, 3);
    expect(result.text).toBe("a😀b");
    expect(result.truncated).toBe(true);
  });
});
