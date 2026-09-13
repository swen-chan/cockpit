import type { LedgerItem } from "@/contracts/cockpit";
import { cn } from "@/lib/cn";

interface SourceLedgerProps {
  title?: string;
  items: LedgerItem[];
}

export function SourceLedger({ items, title = "Source ledger" }: SourceLedgerProps) {
  return (
    <aside className="source-ledger" aria-label={title}>
      <div className="ledger-heading">
        <span className="status-dot" aria-hidden="true" />
        <h2>{title}</h2>
      </div>
      <dl>
        {items.map((item) => (
          <div key={`${item.label}-${item.value}`}>
            <dt>{item.label}</dt>
            <dd className={cn(item.mono && "mono")}>{item.value}</dd>
          </div>
        ))}
      </dl>
    </aside>
  );
}
