import type { PanelConfigurationState } from "@/server/panels/registry";

export function PanelConfigurationStateView({
  configuration,
}: {
  configuration: PanelConfigurationState;
}) {
  const invalid = configuration.state === "invalid";
  return (
    <main className="page-wrap" id="main-content" tabIndex={-1}>
      <header className="page-header">
        <div>
          <h1>{invalid ? "Invalid Agent configuration" : "No Agent configured"}</h1>
          <p className="page-description">
            {invalid
              ? "Correct the configuration below, then restart Cockpit."
              : "Configure Hermes or Codex in .env.local, then restart Cockpit."}
          </p>
        </div>
      </header>
      {invalid ? (
        <section className="source-state source-state-error" role="alert">
          <div>
            <h2>{configuration.key}</h2>
            <p>{configuration.requirement}</p>
          </div>
        </section>
      ) : null}
      <p>
        <a href="https://github.com/swen-chan/cockpit#choose-your-local-sources">
          Read the configuration guide
        </a>
      </p>
    </main>
  );
}
