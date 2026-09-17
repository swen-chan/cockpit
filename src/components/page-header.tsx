interface PageHeaderProps {
  title: string;
  description: string;
  mode: string;
  observedAt: string;
}

export function PageHeader({ description, mode, observedAt, title }: PageHeaderProps) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        <p className="page-description">{description}</p>
      </div>
      <dl className="header-stamp">
        <div>
          <dt>Observed</dt>
          <dd>{observedAt}</dd>
        </div>
        <div>
          <dt>Mode</dt>
          <dd>{mode}</dd>
        </div>
      </dl>
    </header>
  );
}
