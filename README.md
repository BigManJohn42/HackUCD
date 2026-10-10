# ÉirGo

Editable, step-by-step commute planner for one real Dublin corridor (UCD Belfield -> city
centre via Dundrum), with live disruption alerts over WebSocket and an AI concierge
(OpenRouter) that gives break-time recommendations at each transfer.

## Setup

```bash
cd server && npm install && cp .env.example .env
cd ../client && npm install
```

Fill in `server/.env`:
- `OPENROUTER_API_KEY` — https://openrouter.ai/keys (chat works with a canned fallback
  reply if left blank, so the rest of the app still runs without it)
- `STRIPE_SECRET_KEY` — a **test mode** secret key from
  https://dashboard.stripe.com/test/apikeys (needed only for the Pro upgrade flow)

## Run

Two terminals:

```bash
cd server && npm run dev   # http://localhost:4000
cd client && npm run dev   # http://localhost:5173
```

Open http://localhost:5173.

## What's real vs. mocked

- **Route data**: hand-entered from NTA's published Dublin Bus/Luas schedules for one
  corridor — not a general router. See `server/src/data/corridor.ts`.
- **Live alerts**: simulated in `server/src/services/liveFeed.ts` on the same polling
  interval a real NTA GTFS-Realtime integration would use. Swap the body of `pollOnce`
  for a real fetch against the GTFS-RT feed; the Socket.IO relay and UI don't need to
  change.
- **AI concierge**: a real OpenRouter call (`server/src/services/openrouter.ts`).
- **Stripe**: a real sandbox Checkout Session (subscription, test price) — use card
  `4242 4242 4242 4242`, any future expiry/CVC.
