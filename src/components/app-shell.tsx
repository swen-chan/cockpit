import { Eye, HardDrive } from "lucide-react";
import type { ReactNode } from "react";

import { Navigation } from "@/components/navigation";
import type { ProfileSummary } from "@/contracts/cockpit";

export function AppShell({ children, profile }: { children: ReactNode; profile: ProfileSummary }) {
  return (
    <div className="app-shell">
      <aside className="navigation-rail">
        <div className="product-mark">
          <Eye aria-hidden="true" size={19} strokeWidth={1.8} />
          <span>COCKPIT</span>
          <small>/ HERMES</small>
        </div>
        <div className="readonly-strip">
          <span className="status-dot" aria-hidden="true" />
          READ ONLY
        </div>
        <Navigation />
        <div className="profile-stamp">
          <HardDrive aria-hidden="true" size={16} />
          <div>
            <span>PROFILE</span>
            <strong>{profile.profile}</strong>
            <small>{profile.homeLabel}</small>
          </div>
        </div>
      </aside>
      <main className="main-canvas" id="main-content">
        {children}
      </main>
    </div>
  );
}
