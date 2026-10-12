import { Router, type Request, type Response } from "express";
import {
  applyWebhookEvent,
  confirmCheckoutSession,
  constructWebhookEvent,
  createCheckoutSession,
  getSubscriptionStatus,
} from "../services/stripe.js";
import { FREE_PLAN_LIMIT, getUsage } from "../services/planUsage.js";
import { requireAuth } from "../middleware/auth.js";

export const billingRouter = Router();

billingRouter.get("/billing/status", requireAuth, (req, res) => {
  const status = getSubscriptionStatus(req.user!.id);
  const freePlansLeft = status.isPro ? null : Math.max(0, FREE_PLAN_LIMIT - getUsage(req.user!.id));
  res.json({ ...status, freePlansLeft });
});

billingRouter.post("/billing/create-checkout-session", requireAuth, async (req, res) => {
  const plan = req.body?.plan === undefined ? "monthly" : req.body.plan;
  if (plan !== "monthly" && plan !== "yearly") {
    res.status(400).json({ error: "plan must be monthly or yearly" });
    return;
  }
  const clientOrigin = process.env.CLIENT_ORIGIN || "http://localhost:5173";
  try {
    const session = await createCheckoutSession(clientOrigin, plan, req.user!.id, req.user!.email);
    res.json({ url: session.url });
  } catch (err) {
    console.error("[billing] failed to create checkout session:", err);
    res.status(502).json({
      error: err instanceof Error ? err.message : "Could not create a Stripe checkout session.",
    });
  }
});

billingRouter.get("/billing/confirm", requireAuth, async (req, res) => {
  const sessionId = req.query.session_id;
  if (typeof sessionId !== "string") {
    res.status(400).json({ error: "session_id is required" });
    return;
  }
  try {
    const result = await confirmCheckoutSession(sessionId, req.user!.id);
    res.json(result);
  } catch (err) {
    console.error("[billing] failed to confirm session:", err);
    res.status(502).json({ error: "Could not confirm the checkout session." });
  }
});

// Stripe's real source of truth for subscription lifecycle events. Exported
// separately (not on billingRouter) because signature verification needs the
// exact raw request bytes - it's mounted in index.ts with express.raw(),
// BEFORE the global express.json() parser touches the body.
export async function billingWebhookHandler(req: Request, res: Response) {
  const signature = req.headers["stripe-signature"];
  if (typeof signature !== "string") {
    res.status(400).json({ error: "missing stripe-signature header" });
    return;
  }
  try {
    const event = constructWebhookEvent(req.body, signature);
    await applyWebhookEvent(event);
    res.json({ received: true });
  } catch (err) {
    console.error("[billing] webhook error:", err instanceof Error ? err.message : err);
    res.status(400).json({ error: "Webhook signature verification failed." });
  }
}
