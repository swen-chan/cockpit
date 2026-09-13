import { expect, test } from "@playwright/test";

const dataEndpoints = [
  "/api/overview",
  "/api/system",
  "/api/system/context?id=skill-abcdef1234567890abcdef12",
  "/api/conversations",
  "/api/conversations/conversation-invalid",
  "/api/files",
  "/api/files/preview?path=fixture.txt",
  "/api/jobs",
] as const;

test("serves the app with restrictive browser headers", async ({ request }) => {
  const response = await request.get("/");
  expect(response.status()).toBe(200);

  const headers = response.headers();
  const directives = headers["content-security-policy"]?.split("; ") ?? [];
  expect(directives).toContain("default-src 'self'");
  expect(directives).toContain("connect-src 'self'");
  expect(directives).toContain("img-src 'self' data:");
  expect(directives).toContain("frame-src 'none'");
  expect(directives).toContain("frame-ancestors 'none'");
  expect(directives).toContain("object-src 'none'");
  expect(headers["cross-origin-resource-policy"]).toBe("same-origin");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers).not.toHaveProperty("access-control-allow-origin");
});

test("rejects mutation methods across every data endpoint", async ({ request }) => {
  for (const endpoint of dataEndpoints) {
    for (const method of ["post", "put", "patch", "delete"] as const) {
      const response = await request[method](endpoint);
      expect(response.status(), `${method.toUpperCase()} ${endpoint}`).toBe(405);
      expect(response.headers()["cache-control"]).toBe("private, no-store");
    }
  }
});

test("rejects unapproved Host, Origin, and query input", async ({ request }) => {
  const badHost = await request.get("/api/jobs", { headers: { Host: "evil.test" } });
  expect(badHost.status()).toBe(403);

  const badOrigin = await request.get("/api/jobs", {
    headers: { Origin: "https://evil.test" },
  });
  expect(badOrigin.status()).toBe(403);

  const crossSiteSubresource = await request.get("/api/jobs", {
    headers: { "Sec-Fetch-Mode": "no-cors", "Sec-Fetch-Site": "cross-site" },
  });
  expect(crossSiteSubresource.status()).toBe(403);

  const badQuery = await request.get("/api/jobs?source=/private/source");
  expect(badQuery.status()).toBe(400);
  expect(await badQuery.json()).toMatchObject({ sourceId: "jobs", code: "invalid_path" });
  expect(badQuery.headers()["cross-origin-resource-policy"]).toBe("same-origin");
  expect(badQuery.headers()["x-content-type-options"]).toBe("nosniff");

  for (const response of [badHost, badOrigin, crossSiteSubresource, badQuery]) {
    expect(response.headers()).not.toHaveProperty("access-control-allow-origin");
  }
});
