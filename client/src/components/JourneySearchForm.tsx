import { useEffect, useState } from "react";
import { searchPlaces, type JourneyQuery } from "../api";
import { FREE_PLAN_LIMIT } from "../planAllowance";

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

const MAX_STOPOVERS = 5; // matches the server's limit

interface StopoverDraft {
  id: number; // stable React key while rows are added/removed
  place: string;
  hours: string;
}
let nextStopoverId = 1;

export function JourneySearchForm({
  onSearch,
  onLoadSample,
  searching,
  error,
  freePlansLeft,
}: {
  onSearch: (query: JourneyQuery) => void;
  onLoadSample: () => void;
  searching: boolean;
  error: string | null;
  freePlansLeft: number | null; // null = Pro (unlimited)
}) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [stopovers, setStopovers] = useState<StopoverDraft[]>([]);
  const [depart, setDepart] = useState("");

  const updateStopover = (id: number, patch: Partial<StopoverDraft>) =>
    setStopovers((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const addStopover = () =>
    setStopovers((prev) => [...prev, { id: nextStopoverId++, place: "", hours: "2" }]);
  const removeStopover = (id: number) => setStopovers((prev) => prev.filter((s) => s.id !== id));

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Out of free plans: the button is an upgrade link, so don't insist on filled-in places.
    if (freePlansLeft !== 0 && (!from.trim() || !to.trim())) return;
    onSearch({
      from: from.trim(),
      to: to.trim(),
      // Empty rows are ignored; a blank or invalid stay falls back to 2 hours.
      stopovers: stopovers
        .filter((s) => s.place.trim())
        .map((s) => {
          const mins = Math.round(Number(s.hours) * 60);
          return { place: s.place.trim(), stayMins: Number.isFinite(mins) && mins >= 0 ? mins : 120 };
        }),
      depart: depart || undefined,
    });
  }

  return (
    <form className="card journey-search" onSubmit={handleSubmit}>
      <h2 style={{ marginTop: 0 }}>Plan a real journey</h2>
      <PlaceInput id="from-input" label="From" value={from} onChange={setFrom} placeholder="e.g. UCD" />

      {stopovers.map((s, i) => (
        <div className="stopover-row" key={s.id}>
          <div className="stopover-place">
            <PlaceInput
              id={`stopover-${s.id}`}
              label={`Stopover ${i + 1}`}
              value={s.place}
              onChange={(place) => updateStopover(s.id, { place })}
              placeholder="e.g. Athlone"
            />
          </div>
          <div className="stopover-hours">
            <label htmlFor={`stopover-${s.id}-hours`}>Stay (hours)</label>
            <input
              id={`stopover-${s.id}-hours`}
              type="number"
              min="0"
              max="72"
              step="0.5"
              value={s.hours}
              onChange={(e) => updateStopover(s.id, { hours: e.target.value })}
            />
          </div>
          <button
            type="button"
            className="btn-secondary stopover-remove"
            onClick={() => removeStopover(s.id)}
            aria-label={`Remove stopover ${i + 1}${s.place ? ` (${s.place})` : ""}`}
          >
            Remove
          </button>
        </div>
      ))}

      {stopovers.length < MAX_STOPOVERS && (
        <button type="button" className="btn-secondary add-stopover" onClick={addStopover}>
          + Add a stopover
        </button>
      )}

      <PlaceInput id="to-input" label="To" value={to} onChange={setTo} placeholder="e.g. Galway" />

      <label htmlFor="depart-input">
        Leave at <span className="optional">(default: now)</span>
      </label>
      <input id="depart-input" type="time" value={depart} onChange={(e) => setDepart(e.target.value)} />

      {error && (
        <p className="break-suggestion" role="alert" style={{ color: "var(--color-critical-text)" }}>
          {error}
        </p>
      )}

      <div className="leg-actions" style={{ marginTop: 12 }}>
        <button type="submit" className="btn-primary" disabled={searching}>
          {searching ? "Finding your route..." : freePlansLeft === 0 ? "Upgrade to keep planning" : "Find my route"}
        </button>
        <button type="button" className="btn-secondary" onClick={onLoadSample} disabled={searching}>
          Try the sample UCD route
        </button>
      </div>
      {freePlansLeft !== null && (
        <p className={`free-plans${freePlansLeft <= 1 ? " free-plans-low" : ""}`}>
          {freePlansLeft > 0
            ? `${freePlansLeft} of ${FREE_PLAN_LIMIT} free journey plans left`
            : "You've used all your free journey plans"}
          {" · "}
          <a href="#/subscriptions">Get unlimited with Pro</a>
        </p>
      )}
      <p className="leg-meta" style={{ marginTop: 10, marginBottom: 0 }}>
        Real stops and timetables from Ireland's National Transport Authority, with live delays
        where available. Type a few letters for suggestions - stop names work best.
      </p>
    </form>
  );
}
