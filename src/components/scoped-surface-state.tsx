import { PageHeader } from "@/components/page-header";
import { SourceState } from "@/components/source-state";
import type { AgentSurface, PublicAgentPanel } from "@/contracts/agents";
import { panelSurfaceLabel } from "@/lib/panel-navigation";
import { formatShanghaiTime } from "@/lib/time";

export function UnsupportedSurface({
  panel,
  surface,
}: {
  panel: PublicAgentPanel;
  surface: AgentSurface;
}) {
  const label = panelSurfaceLabel(panel, surface);
  return (
    <div className="page-wrap">
      <PageHeader
        title={label}
        description={`${panel.name} does not provide this read-only surface.`}
        observedAt={formatShanghaiTime(new Date().toISOString())}
        mode={`${panel.runtime.toUpperCase()} / UNSUPPORTED`}
      />
      <SourceState
        kind="unavailable"
        detail={`Unsupported for ${panel.name}. No runtime source was read.`}
      />
    </div>
  );
}

export function StagedSurface({
  panel,
  surface,
}: {
  panel: PublicAgentPanel;
  surface: AgentSurface;
}) {
  const label = panelSurfaceLabel(panel, surface);
  return (
    <div className="page-wrap">
      <PageHeader
        title={label}
        description={`Inspect ${panel.name} ${label.toLowerCase()} inside the selected read-only scope.`}
        observedAt={formatShanghaiTime(new Date().toISOString())}
        mode={`${panel.runtime.toUpperCase()} / READ ONLY`}
      />
      <section className="staged-surface" aria-labelledby="staged-surface-title">
        <p className="eyebrow">SUPPORTED SURFACE</p>
        <h2 id="staged-surface-title">Inspection view pending</h2>
        <p>
          The Agent scope is valid. Detailed {label} rendering is delivered in its dedicated
          implementation unit.
        </p>
      </section>
    </div>
  );
}
