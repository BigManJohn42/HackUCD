import { FREE_PLAN_LIMIT } from "../planAllowance";
import type { SubscriptionPlan } from "../types";

const PLANS: { id: SubscriptionPlan; label: string; price: string; period: string }[] = [
  { id: "monthly", label: "Monthly", price: "2.99", period: "month" },
  { id: "yearly", label: "Yearly", price: "24.99", period: "year" },
];

const BENEFITS = [
  "Unlimited journey plans",
  "Unlimited saved itineraries",
  "Richer, more detailed AI break recommendations",
  "Priority support during live disruptions",
];

export function SubscriptionsPage({
  isPro,
  upgrading,
  onUpgrade,
  limitReached = false,
}: {
  isPro: boolean;
  upgrading: SubscriptionPlan | null;
  onUpgrade: (plan: SubscriptionPlan) => void;
  limitReached?: boolean; // sent here by the planner after the free plans ran out
}) {
  return (
    <section>
      {limitReached && (
        <div className="limit-banner" role="status">
          <strong>You've used your {FREE_PLAN_LIMIT} free journey plans.</strong>
          <span>Upgrade to ÉirGo Pro for unlimited journey planning.</span>
        </div>
      )}
      <div className="page-heading">
        <span className="eyebrow">Explore the plans</span>
        <h1>A plan for your routine.</h1>
        <p>The same Pro benefits, with monthly or yearly billing. Save when you subscribe yearly.</p>
      </div>

      <div className="plans-grid">
        {PLANS.map((plan) => (
          <article key={plan.id} className={`card plan-card${plan.id === "yearly" ? " plan-card-yearly" : ""}`}>
            <div className="plan-card-heading">
              <span className="eyebrow">{plan.label}</span>
              {plan.id === "yearly" && <span className="plan-savings-badge">Save 30%</span>}
            </div>
            <h2>ÉirGo Pro</h2>
            <p className="price">
              &euro;{plan.price}<span> / {plan.period}</span>
            </p>
            <p className="plan-billing">{plan.id === "yearly" ? "Billed annually" : "Billed monthly"}</p>
            {plan.id === "yearly" && (
              <p className="plan-savings">Save &euro;10.89 a year compared with monthly.</p>
            )}
            <ul className="benefits">
              {BENEFITS.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
            {isPro ? (
              <span className="pro-badge">You're subscribed</span>
            ) : (
              <button type="button" className="btn-primary" onClick={() => onUpgrade(plan.id)} disabled={upgrading !== null} aria-label={`Subscribe ${plan.label.toLowerCase()}`}>
                {upgrading === plan.id ? "Redirecting..." : "Subscribe"}
              </button>
            )}
          </article>
        ))}
      </div>
      <p className="leg-meta">
        Payments run through Stripe's sandbox for this prototype - test card 4242 4242 4242
        4242, any future expiry and CVC. No real charge is made.
      </p>
    </section>
  );
}
