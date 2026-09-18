import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { securityResponseHeaders } from "../../next.config";
import {
  isApprovedLoopbackHost,
  isApprovedOrigin,
  isUnexpectedCrossSiteRequest,
  proxy,
} from "@/proxy";

function proxiedRequest(
  host: string | null,
  origin: string | null = null,
  fetchMetadata?: { mode: string; site: string },
): NextRequest {
  const headers = new Headers();
  if (host !== null) headers.set("host", host);
  if (origin !== null) headers.set("origin", origin);
  if (fetchMetadata !== undefined) {
    headers.set("sec-fetch-mode", fetchMetadata.mode);
    headers.set("sec-fetch-site", fetchMetadata.site);
  }
  return new NextRequest("http://127.0.0.1:3000/api/jobs", { headers });
}

describe("local HTTP security boundary", () => {
  it("accepts only the bound IPv4 loopback host with a valid optional port", () => {
    for (const host of ["127.0.0.1", "127.0.0.1:3000", "127.0.0.1:65535"]) {
      expect(isApprovedLoopbackHost(host)).toBe(true);
    }
    for (const host of [
      null,
      "localhost:3000",
      "127.0.0.1.evil.test",
      "127.0.0.1:0",
      "127.0.0.1:65536",
      "[::1]:3000",
    ]) {
      expect(isApprovedLoopbackHost(host)).toBe(false);
    }
  });

  it("allows absent Origin or the exact request origin and rejects every other origin", () => {
    expect(isApprovedOrigin("127.0.0.1:3000", null)).toBe(true);
    expect(isApprovedOrigin("127.0.0.1:3000", "http://127.0.0.1:3000")).toBe(true);
    expect(isApprovedOrigin("127.0.0.1:3000", "http://127.0.0.1:3001")).toBe(false);
    expect(isApprovedOrigin("127.0.0.1:3000", "https://127.0.0.1:3000")).toBe(false);
    expect(isApprovedOrigin("127.0.0.1:3000", "null")).toBe(false);
  });

  it("rejects unapproved Host and Origin values before routing", async () => {
    expect(proxy(proxiedRequest("127.0.0.1:3000")).status).toBe(200);
    expect(proxy(proxiedRequest("127.0.0.1:3000", "http://127.0.0.1:3000")).status).toBe(200);

    for (const request of [
      proxiedRequest(null),
      proxiedRequest("evil.test"),
      proxiedRequest("127.0.0.1:3000", "https://evil.test"),
      proxiedRequest("127.0.0.1:3000", null, { mode: "no-cors", site: "cross-site" }),
    ]) {
      const response = proxy(request);
      expect(response.status).toBe(403);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      await expect(response.text()).resolves.toBe("Forbidden");
    }
  });

  it("blocks browser cross-site no-cors subresources without blocking navigation or curl", () => {
    expect(
      isUnexpectedCrossSiteRequest(
        new Headers({
          "sec-fetch-mode": "no-cors",
          "sec-fetch-site": "cross-site",
        }),
      ),
    ).toBe(true);
    expect(
      isUnexpectedCrossSiteRequest(
        new Headers({
          "sec-fetch-mode": "navigate",
          "sec-fetch-site": "cross-site",
        }),
      ),
    ).toBe(false);
    expect(isUnexpectedCrossSiteRequest(new Headers())).toBe(false);
  });

  it("sets a same-origin content policy without enabling CORS or HTTPS upgrade", () => {
    const headers = new Headers(
      securityResponseHeaders.map(({ key, value }): [string, string] => [key, value]),
    );
    const policy = headers.get("content-security-policy") ?? "";
    const directives = policy.split("; ");

    expect(directives).toContain("default-src 'self'");
    expect(directives).toContain("connect-src 'self'");
    expect(directives).toContain("img-src 'self' data:");
    expect(directives).toContain("frame-src 'none'");
    expect(directives).toContain("frame-ancestors 'none'");
    expect(directives).toContain("object-src 'none'");
    expect(policy).not.toContain("upgrade-insecure-requests");
    expect(headers.get("cross-origin-resource-policy")).toBe("same-origin");
    expect(headers.get("x-content-type-options")).toBe("nosniff");
    expect(headers.get("x-frame-options")).toBe("DENY");
    expect(headers.get("access-control-allow-origin")).toBeNull();
  });
});
