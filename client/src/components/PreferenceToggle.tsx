import type { Preference } from "../types";

const OPTIONS: { value: Preference; label: string }[] = [
  { value: "fastest", label: "Fastest" },
  { value: "fewest-transfers", label: "Fewest transfers" },
  { value: "cheapest", label: "Cheapest" },
];

export function PreferenceToggle({
  value,
  onChange,
}: {
  value: Preference;
  onChange: (p: Preference) => void;
}) {
  return (
    <div className="preference-toggle" role="group" aria-label="Journey preference">
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          aria-pressed={value === opt.value}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
