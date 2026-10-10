import { useEffect, useState } from "react";
import { searchPlaces, type JourneyQuery } from "../api";

/** Debounced stop-name suggestions for one input. */
function useSuggestions(query: string): string[] {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  useEffect(() => {
    const timer = setTimeout(() => {
      searchPlaces(query).then(setSuggestions).catch(() => setSuggestions([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);
  return suggestions;
}

function PlaceInput({
  id,
  label,
  value,
  onChange,
  placeholder,
  optional,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  optional?: boolean;
}) {
  const suggestions = useSuggestions(value);
  return (
    <>
      <label htmlFor={id}>
        {label} {optional && <span className="optional">(optional)</span>}
      </label>
      <input
        id={id}
        list={`${id}-suggestions`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
      />
      <datalist id={`${id}-suggestions`}>
        {suggestions.map((p) => (
          <option key={p} value={p} />
        ))}
      </datalist>
    </>
  );
}

export function JourneySearchForm({
  onSearch,
  onLoadSample,
  searching,
  error,
}: {
  onSearch: (query: JourneyQuery) => void;
  onLoadSample: () => void;
  searching: boolean;
  error: string | null;
}) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [via, setVia] = useState("");
  const [stayHours, setStayHours] = useState("2");
  const [depart, setDepart] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!from.trim() || !to.trim()) return;
    const stay = Math.round(Number(stayHours) * 60);
    onSearch({
      from: from.trim(),
      to: to.trim(),
      via: via.trim() || undefined,
      stayMins: via.trim() && Number.isFinite(stay) ? stay : undefined,
      depart: depart || undefined,
    });
  }

  return (
    <form className="card journey-search" onSubmit={handleSubmit}>
      <h2 style={{ marginTop: 0 }}>Plan a real journey</h2>
      <PlaceInput id="from-input" label="From" value={from} onChange={setFrom} placeholder="e.g. UCD" />
      <PlaceInput id="to-input" label="To" value={to} onChange={setTo} placeholder="e.g. Galway" />

      <PlaceInput
        id="via-input"
        label="Stop over at"
        value={via}
        onChange={setVia}
        placeholder="e.g. Athlone - break up a long trip"
        optional
      />

      <div className="search-row">
        <div>
          <label htmlFor="stay-input">Stay for (hours)</label>
          <input
            id="stay-input"
            type="number"
            min="0"
            max="72"
            step="0.5"
            value={stayHours}
            onChange={(e) => setStayHours(e.target.value)}
            disabled={!via.trim()}
            title={via.trim() ? undefined : "Add a stopover place first"}
          />
        </div>
        <div>
          <label htmlFor="depart-input">
            Leave at <span className="optional">(default: now)</span>
          </label>
          <input id="depart-input" type="time" value={depart} onChange={(e) => setDepart(e.target.value)} />
        </div>
      </div>

      {error && (
        <p className="break-suggestion" role="alert" style={{ color: "var(--color-critical-text)" }}>
          {error}
        </p>
      )}

      <div className="leg-actions" style={{ marginTop: 12 }}>
        <button type="submit" className="btn-primary" disabled={searching}>
          {searching ? "Finding your route..." : "Find my route"}
        </button>
        <button type="button" className="btn-secondary" onClick={onLoadSample} disabled={searching}>
          Try the sample UCD route
        </button>
      </div>
      <p className="leg-meta" style={{ marginTop: 10, marginBottom: 0 }}>
        Real stops and timetables from Ireland's National Transport Authority, with live delays
        where available. Type a few letters for suggestions - stop names work best.
      </p>
    </form>
  );
}
