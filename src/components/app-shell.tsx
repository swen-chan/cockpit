import { Eye, HardDrive } from "lucide-react";
import type { ReactNode } from "react";

import { AgentPanelNavigation } from "@/components/agent-panel-navigation";
import { Navigation } from "@/components/navigation";
import type { PublicAgentPanel } from "@/contracts/agents";
import type { ProfileSummary } from "@/contracts/cockpit";
import { cn } from "@/lib/cn";

function ShellFrame({
  agentNavigation,
  children,
  dual,
  footer,
  markSuffix,
  navigation,
}: {
  agentNavigation?: ReactNode;
  children: ReactNode;
  dual?: boolean;
  footer?: ReactNode;
  markSuffix?: string | undefined;
  navigation: ReactNode;
}) {
  return (
    <div className={cn("app-shell", dual && "app-shell-dual")}>
      <aside className="navigation-rail">
        <div className="product-mark">
          <Eye aria-hidden="true" size={19} strokeWidth={1.8} />
          <span>COCKPIT</span>
          {markSuffix ? <small>/ {markSuffix}</small> : null}
        </div>
        <div className="readonly-strip">
          <span className="status-dot" aria-hidden="true" />
          READ ONLY
        </div>
        {agentNavigation}
        {navigation}
        {footer}
      </aside>
      <main className="main-canvas" id="main-content" tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}

export function AppShell({ children, profile }: { children: ReactNode; profile: ProfileSummary }) {
  return (
    <ShellFrame
      markSuffix="HERMES"
      navigation={<Navigation />}
      footer={
        <div className="profile-stamp">
          <HardDrive aria-hidden="true" size={16} />
          <div>
            <span>PROFILE</span>
            <strong>{profile.profile}</strong>
            <small>{profile.homeLabel}</small>
          </div>
        </div>
      }
    >
      {children}
    </ShellFrame>
  );
}

export function ScopedAppShell({
  activePanel,
  children,
  panels,
}: {
  activePanel: PublicAgentPanel;
  children: ReactNode;
  panels: readonly PublicAgentPanel[];
}) {
  const dual = panels.length > 1;
  return (
    <ShellFrame
      dual={dual}
      markSuffix={dual ? undefined : activePanel.name.toUpperCase()}
      agentNavigation={<AgentPanelNavigation activePanel={activePanel} panels={panels} />}
      navigation={<Navigation panel={activePanel} />}
      footer={
        <div className="panel-stamp">
          <span>ACTIVE AGENT</span>
          <strong>{activePanel.name}</strong>
          <small>RUNTIME / {activePanel.runtime.toUpperCase()}</small>
        </div>
      }
    >
      {children}
    </ShellFrame>
  );
}
