import { expect, test } from "@playwright/test";

const removedRoutes = [
  "/system",
  "/conversations",
  "/files",
  "/jobs",
  "/api/overview",
  "/api/system",
  "/api/system/context?id=skill-abcdef1234567890abcdef12",
  "/api/conversations",
  "/api/conversations/conversation-invalid",
  "/api/files",
  "/api/files/preview?path=fixture.txt",
  "/api/jobs",
] as const;

test("returns 404 for removed unscoped routes without redirecting", async ({ request }) => {
  for (const route of removedRoutes) {
    const response = await request.get(route, { maxRedirects: 0 });
    expect(response.status(), route).toBe(404);
    expect(response.headers(), route).not.toHaveProperty("location");
  }
});
