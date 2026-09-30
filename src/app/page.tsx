import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { PanelConfigurationStateView } from "@/components/panel-configuration-state";
import { LAST_PANEL_COOKIE, panelDefaultSurface, panelSurfaceHref } from "@/lib/panel-navigation";
import { chooseInitialPanelId, resolvePanel, resolvePanelRegistry } from "@/server/panels/registry";

export default async function HomePage() {
  const registry = resolvePanelRegistry();
  if (registry.state !== "ready") return <PanelConfigurationStateView configuration={registry} />;
  const remembered = (await cookies()).get(LAST_PANEL_COOKIE)?.value;
  const panel = resolvePanel(registry, chooseInitialPanelId(registry, remembered));
  redirect(panelSurfaceHref(panel.id, panelDefaultSurface(panel)));
}
