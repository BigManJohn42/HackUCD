import Stripe from "stripe";
import { db } from "../db/db.js";

let stripeClient: Stripe | null = null;

function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error("STRIPE_SECRET_KEY is not set in server/.env (use a sandbox/test key).");
  }
  if (!stripeClient) stripeClient = new Stripe(key);
  return stripeClient;
}

export type SubscriptionPlan = "monthly" | "yearly";

const PLAN_PRICES = {
  monthly: { amount: 299, interval: "month" },
  yearly: { amount: 2499, interval: "year" },
} as const;

interface SubscriptionRow {
  user_id: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  plan: string | null;
  status: string;
  current_period_end: string | null;
  updated_at: string;
}

const ACTIVE_STATUSES = new Set(["active", "trialing"]);

export function getSubscriptionStatus(userId: string): { isPro: boolean; plan: SubscriptionPlan | null; status: string } {
  const row = db.prepare("SELECT * FROM subscriptions WHERE user_id = ?").get(userId) as SubscriptionRow | undefined;
  if (!row) return { isPro: false, plan: null, status: "inactive" };
  return { isPro: ACTIVE_STATUSES.has(row.status), plan: row.plan as SubscriptionPlan | null, status: row.status };
}

function upsertSubscription(fields: Partial<SubscriptionRow> & { user_id: string }) {
  const existing = db.prepare("SELECT user_id FROM subscriptions WHERE user_id = ?").get(fields.user_id);
  const updatedAt = new Date().toISOString();
  if (existing) {
    const sets = Object.keys(fields)
      .filter((k) => k !== "user_id")
      .map((k) => `${k} = ?`);
    const values = Object.keys(fields)
      .filter((k) => k !== "user_id")
      .map((k) => (fields as Record<string, unknown>)[k] as string | number | null);
    db.prepare(`UPDATE subscriptions SET ${sets.join(", ")}, updated_at = ? WHERE user_id = ?`).run(
      ...values,
      updatedAt,
      fields.user_id
    );
  } else {
    db.prepare(
      `INSERT INTO subscriptions (user_id, stripe_customer_id, stripe_subscription_id, plan, status, current_period_end, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      fields.user_id,
      fields.stripe_customer_id ?? null,
      fields.stripe_subscription_id ?? null,
      fields.plan ?? null,
      fields.status ?? "inactive",
      fields.current_period_end ?? null,
      updatedAt
    );
  }
}

async function getOrCreateStripeCustomer(userId: string, email: string): Promise<string> {
  const row = db.prepare("SELECT stripe_customer_id FROM subscriptions WHERE user_id = ?").get(userId) as
    | { stripe_customer_id: string | null }
    | undefined;
  if (row?.stripe_customer_id) return row.stripe_customer_id;

  const stripe = getStripe();
  const customer = await stripe.customers.create({ email, metadata: { userId } });
  upsertSubscription({ user_id: userId, stripe_customer_id: customer.id, status: "inactive" });
  return customer.id;
}

export async function createCheckoutSession(
  clientOrigin: string,
  plan: SubscriptionPlan,
  userId: string,
  email: string
) {
  const price = PLAN_PRICES[plan];
  const stripe = getStripe();
  const customerId = await getOrCreateStripeCustomer(userId, email);

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [
      {
        price_data: {
          currency: "eur",
          unit_amount: price.amount,
          recurring: { interval: price.interval },
          product_data: {
            name: "ÉirGo Pro",
            description: "Unlimited saved itineraries and richer AI break recommendations.",
          },
        },
        quantity: 1,
      },
    ],
    metadata: { userId, plan },
    subscription_data: { metadata: { userId, plan } },
    success_url: `${clientOrigin}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${clientOrigin}/?checkout=cancelled`,
  });
  return session;
}

/** Optimistic confirmation right after the Stripe redirect - the webhook below is
 * the real source of truth, but this gives immediate UI feedback without needing
 * the Stripe CLI forwarding webhooks to a local dev server. */
export async function confirmCheckoutSession(sessionId: string, userId: string) {
  const stripe = getStripe();
  const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["subscription"] });

  if (session.metadata?.userId !== userId) {
    throw new Error("This checkout session doesn't belong to the signed-in user.");
  }

  if (session.payment_status === "paid" || session.status === "complete") {
    const sub = session.subscription;
    upsertSubscription({
      user_id: userId,
      stripe_customer_id: typeof session.customer === "string" ? session.customer : session.customer?.id,
      stripe_subscription_id: typeof sub === "string" ? sub : sub?.id,
      plan: (session.metadata?.plan as SubscriptionPlan) ?? null,
      status: "active",
      current_period_end:
        sub && typeof sub !== "string" ? new Date(sub.current_period_end * 1000).toISOString() : null,
    });
  }

  return getSubscriptionStatus(userId);
}

/** The real source of truth: Stripe calls this for every subscription lifecycle
 * event (renewed, payment failed, cancelled, plan changed) regardless of whether
 * the user is still on the success page. Requires STRIPE_WEBHOOK_SECRET; for local
 * dev, forward events with `stripe listen --forward-to localhost:4000/api/billing/webhook`. */
export function constructWebhookEvent(rawBody: Buffer, signature: string): Stripe.Event {
  const stripe = getStripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET is not set in server/.env.");
  return stripe.webhooks.constructEvent(rawBody, signature, secret);
}

export async function applyWebhookEvent(event: Stripe.Event) {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.metadata?.userId;
      if (!userId) break;
      const sub = session.subscription;
      const subId = typeof sub === "string" ? sub : sub?.id;
      upsertSubscription({
        user_id: userId,
        stripe_customer_id: typeof session.customer === "string" ? session.customer : session.customer?.id,
        stripe_subscription_id: subId,
        plan: (session.metadata?.plan as SubscriptionPlan) ?? null,
        status: "active",
      });
      break;
    }
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      const userId = sub.metadata?.userId;
      if (!userId) break;
      upsertSubscription({
        user_id: userId,
        stripe_subscription_id: sub.id,
        status: event.type === "customer.subscription.deleted" ? "canceled" : sub.status,
        current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
      });
      break;
    }
    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      const subId = typeof invoice.subscription === "string" ? invoice.subscription : invoice.subscription?.id;
      if (!subId) break;
      const row = db.prepare("SELECT user_id FROM subscriptions WHERE stripe_subscription_id = ?").get(subId) as
        | { user_id: string }
        | undefined;
      if (row) upsertSubscription({ user_id: row.user_id, status: "past_due" });
      break;
    }
    default:
      break; // other event types aren't relevant to subscription status
  }
}
