const BENEFITS = [
  "Unlimited saved itineraries",
  "Richer, more detailed AI break recommendations",
  "Priority support during live disruptions",
];

export function SubscriptionsPage({
  isPro,
  upgrading,
  onUpgrade,
}: {
  isPro: boolean;
  upgrading: boolean;
  onUpgrade: () => void;
}) {
  return (
    <section>
      <div className="page-heading">
        <span className="eyebrow">Explore the plans</span>
        <h1>A plan for your routine.</h1>
        <p>One straightforward plan - no tiers to compare, no surprise charges.</p>
      </div>

      <div className="plans-grid">
        <article className="card plan-card">
          <span className="eyebrow">Monthly</span>
          <h2>ÉirGo Pro</h2>
          <p className="price">
            &euro;2.99<span> / month</span>
          </p>
          <ul className="benefits">
            {BENEFITS.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
          {isPro ? (
            <span className="pro-badge">You're subscribed</span>
          ) : (
            <button type="button" className="btn-primary" onClick={onUpgrade} disabled={upgrading}>
              {upgrading ? "Redirecting..." : "Subscribe"}
            </button>
          )}
        </article>
      </div>
      <p className="leg-meta">
        Payments run through Stripe's sandbox for this prototype - test card 4242 4242 4242
        4242, any future expiry and CVC. No real charge is made.
      </p>
    </section>
  );
}
