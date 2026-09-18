"use client";

import { useEffect } from "react";

import type { AgentPanelId } from "@/contracts/agents";
import { LAST_PANEL_COOKIE } from "@/lib/panel-navigation";

const ONE_YEAR_SECONDS = 31_536_000;

export function LastPanelCommit({ panelId }: { panelId: AgentPanelId }) {
  useEffect(() => {
    document.cookie = `${LAST_PANEL_COOKIE}=${panelId}; Path=/; SameSite=Strict; Max-Age=${ONE_YEAR_SECONDS}`;
  }, [panelId]);
  return null;
}
