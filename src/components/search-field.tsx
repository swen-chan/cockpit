import { Search, X } from "lucide-react";

interface SearchFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  resultCount?: number;
}

export function SearchField({ label, onChange, resultCount, value }: SearchFieldProps) {
  return (
    <div className="search-wrap">
      <label className="search-field">
        <Search aria-hidden="true" size={16} />
        <span className="sr-only">{label}</span>
        <input
          type="search"
          placeholder={label}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        {value ? (
          <button type="button" onClick={() => onChange("")} aria-label="Clear search">
            <X aria-hidden="true" size={14} />
          </button>
        ) : null}
      </label>
      {typeof resultCount === "number" && value ? (
        <span className="search-count" role="status">
          {resultCount} match{resultCount === 1 ? "" : "es"}
        </span>
      ) : null}
    </div>
  );
}
