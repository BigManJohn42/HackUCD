import Stripe from "stripe";

let stripeClient: Stripe | null = null;

function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error("STRIPE_SECRET_KEY is not set in server/.env (use a sandbox/test key).");
  }
  if (!stripeClient) stripeClient = new Stripe(key);
  return stripeClient;
}

// In-memory demo "account" — a real app would key this by logged-in user.
// A hackathon prototype doesn't need auth to demonstrate the subscription
// flow, so one flag stands in for "the current user's plan".
let isPro = false;

export function getProStatus() {
  return isPro;
}

export async function createCheckoutSession(clientOrigin: string) {
  const stripe = getStripe();
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [
      {
        price_data: {
          currency: "eur",
          unit_amount: 299,
          recurring: { interval: "month" },
          product_data: {
            name: "Commute Concierge Pro",
            description:
              "Unlimited saved itineraries and richer AI break recommendations.",
          },
        },
        quantity: 1,
      },
    ],
    success_url: `${clientOrigin}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${clientOrigin}/?checkout=cancelled`,
  });
  return session;
}

export async function confirmCheckoutSession(sessionId: string) {
  const stripe = getStripe();
  const session = await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ["subscription"],
  });

  if (session.payment_status === "paid" || session.status === "complete") {
    isPro = true;
  }

  return {
    isPro,
    paymentStatus: session.payment_status,
    subscriptionId:
      typeof session.subscription === "string"
        ? session.subscription
        : session.subscription?.id,
    amountTotal: session.amount_total,
    currency: session.currency,
  };
}
