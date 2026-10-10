import { useState } from "react";

export function BreakPanel({
  amenities,
  onGetSuggestion,
}: {
  amenities: string[];
  onGetSuggestion: (minutes: number) => Promise<string>;
}) {
  const [minutes, setMinutes] = useState(15);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGetSuggestion() {
    setLoading(true);
    setError(null);
    try {
      const reply = await onGetSuggestion(minutes);
      setSuggestion(reply);
    } catch {
      setError("Couldn't reach the concierge just now. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="break-panel">
      <label htmlFor="break-minutes">How long is your break?</label>
      <input
        id="break-minutes"
        type="number"
        min={5}
        max={120}
        step={5}
        value={minutes}
        onChange={(e) => setMinutes(Number(e.target.value))}
      />
      <button type="button" className="btn-primary" onClick={handleGetSuggestion} disabled={loading}>
        {loading ? "Thinking..." : "Get suggestions"}
      </button>

      {amenities.length > 0 && (
        <ul className="amenity-list">
          {amenities.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      )}

      {error && <p className="break-suggestion" role="alert">{error}</p>}
      {suggestion && (
        <>
          <p className="break-suggestion">{suggestion}</p>
          <p className="leg-meta" style={{ marginBottom: 0 }}>
            AI-generated suggestion - double check opening hours and departure times yourself.
          </p>
        </>
      )}
    </div>
  );
}
