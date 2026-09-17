export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { initializePanelTokenSecret } = await import("@/server/panels/opaque-token");
  initializePanelTokenSecret();
  const { reapOwnedTemps } = await import("@/server/codex/owned-temp.mjs");
  reapOwnedTemps();
}
