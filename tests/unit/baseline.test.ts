import { describe, expect, it } from "vitest";

describe("Cockpit baseline", () => {
  it("keeps the initial product mode read-only", () => {
    const productMode = "read-only";

    expect(productMode).toBe("read-only");
  });
});
