import { useEffect, useState } from "react";
import { searchPlaces } from "../api";

export function JourneySearchForm({
  onSearch,
  onLoadSample,
  searching,
  error,
}: {
  onSearch: (from: string, to: string) => void;
  onLoadSample: () => void;
  searching: boolean;
  error: string | null;
}) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [fromSuggestions, setFromSuggestions] = useState<string[]>([]);
  const [toSuggestions, setToSuggestions] = useState<string[]>([]);

  useEffect(() => {
    const timer = setTimeout(() => {
      searchPlaces(from).then(setFromSuggestions).catch(() => setFromSuggestions([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [from]);

  useEffect(() => {
    const timer = setTimeout(() => {
      searchPlaces(to).then(setToSuggestions).catch(() => setToSuggestions([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [to]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!from.trim() || !to.trim()) return;
    onSearch(from.trim(), to.trim());
  }

  return (
    <form className="card journey-search" onSubmit={handleSubmit}>
      <h2 style={{ marginTop: 0 }}>Plan a real journey</h2>
      <label htmlFor="from-input">From</label>
      <input
        id="from-input"
        list="from-suggestions"
        value={from}
        onChange={(e) => setFrom(e.target.value)}
        placeholder="e.g. UCD Belfield"
        autoComplete="off"
      />
      <datalist id="from-suggestions">
        {fromSuggestions.map((p) => (
          <option key={p} value={p} />
        ))}
      </datalist>

      <label htmlFor="to-input">To</label>
      <input
        id="to-input"
        list="to-suggestions"
        value={to}
        onChange={(e) => setTo(e.target.value)}
        placeholder="e.g. Heuston Station"
        autoComplete="off"
      />
      <datalist id="to-suggestions">
        {toSuggestions.map((p) => (
          <option key={p} value={p} />
        ))}
      </datalist>

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
        Real stops and timetables from Ireland's National Transport Authority. Type a few
        letters for suggestions - stop names work best.
      </p>
    </form>
  );
}
