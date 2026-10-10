# EireGo — front-end v0.1.1

A desktop commute-planning prototype for Dublin, built with React, TypeScript, Vite, and plain CSS.

## Run the front end

```sh
cd client
npm install
npm run dev
```

Open http://localhost:5173. Build with `npm run build` and inspect the built app with `npm run preview`.

## Pages

- **Home:** introduction and three choices for planning or viewing subscriptions.
- **Manual Planner:** typed destinations with fetched Dublin suggestions, departure date/time, route selection, and step-by-step timetables.
- **Smart Planner:** chat with transport-data context and structured route cards.
- **Subscriptions:** monthly and yearly plans with prices and benefits fetched from the server; display only in v0.1.

Shared navigation supports browser back/forward and direct hash links. Small, Standard, and Large text settings persist in the browser. Planner state is preserved while navigating and cleared on reload.

## Back-end integration

The front end makes real requests and contains no sample responses or hardcoded subscription prices. Until the proposed endpoints are implemented, it shows unavailable states with retry controls. Manual destination typing stays available; chat requires loaded transport data.

See [the proposed back-end contract](client/BACKEND-CONTRACT.md) for endpoint names, request/response types, time conventions, and testing instructions. Integration functions are centralized in `client/src/api.ts`.

The `server` directory is the unchanged earlier prototype scaffold. Its existing corridor, AI, simulated-alert, and billing endpoints are not the new v0.1 contract. The back-end team can adapt or replace those independently. Vite currently forwards `/api` requests to port 4000.

## Current boundaries

Version 0.1 focuses on desktop and light mode. Dark mode, mobile/tablet adaptation, hosting, checkout, and per-leg editing are deferred. AI and Stripe credentials must remain on the server.
