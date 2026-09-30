import { Eye } from "lucide-react";
import { Suspense, type ReactNode } from "react";
import { ClaudeProjectNavigation } from "@/components/claude-project-navigation";

import { AgentPanelNavigation } from "@/components/agent-panel-navigation";
import { Navigation } from "@/components/navigation";
import type { PublicAgentPanel, PublicClaudeProject } from "@/contracts/agents";
import { cn } from "@/lib/cn";

export function ScopedAppShell({
  activePanel,
  children,
  panels,
  projects = [],
}: {
  activePanel: PublicAgentPanel;
  children: ReactNode;
  panels: readonly PublicAgentPanel[];
  projects?: readonly PublicClaudeProject[];
}) {
  const dual = panels.length > 1;
  return (
    <div
      className={cn(
        "app-shell",
        dual && "app-shell-dual",
        activePanel.runtime === "claude-code" && "app-shell-claude",
      )}
    >
      <aside className="navigation-rail">
        <div className="product-mark">
          <Eye aria-hidden="true" size={19} strokeWidth={1.8} />
          <span>COCKPIT</span>
          {!dual ? <small>/ {activePanel.name.toUpperCase()}</small> : null}
        </div>
        <div className="readonly-strip">
          <span className="status-dot" aria-hidden="true" />
          READ ONLY
        </div>
        <Suspense>
          <AgentPanelNavigation activePanel={activePanel} panels={panels} />
        </Suspense>
        {activePanel.runtime === "claude-code" ? (
          <Suspense fallback={<Navigation panel={activePanel} />}>
            <ClaudeProjectNavigation panel={activePanel} projects={projects} />
          </Suspense>
        ) : (
          <Navigation panel={activePanel} />
        )}
        <div className="panel-stamp">
          <span>ACTIVE AGENT</span>
          <strong>{activePanel.name}</strong>
          <small>RUNTIME / {activePanel.runtime.toUpperCase()}</small>
        </div>
      </aside>
      <main className="main-canvas" id="main-content" tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}
