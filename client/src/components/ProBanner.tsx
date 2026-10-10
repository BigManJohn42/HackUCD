export function ProBanner({
  isPro,
  onUpgrade,
  upgrading,
}: {
  isPro: boolean;
  onUpgrade: () => void;
  upgrading: boolean;
}) {
  return (
    <div className="card pro-banner">
      {isPro ? (
        <>
          <span className="pro-badge">PRO</span>
          <span>Unlimited saved routes and richer AI break recommendations are unlocked.</span>
        </>
      ) : (
        <>
          <div>
            <strong>Commute Concierge Pro</strong> &mdash; &euro;2.99/month for unlimited saved
            itineraries and more detailed AI recommendations.
          </div>
          <button type="button" className="btn-primary" onClick={onUpgrade} disabled={upgrading}>
            {upgrading ? "Redirecting..." : "Upgrade"}
          </button>
        </>
      )}
    </div>
  );
}
