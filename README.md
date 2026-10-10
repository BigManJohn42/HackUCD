# ÉirGo

Editable, step-by-step commute planner. Four pages (Home / Manual Planner / Smart
Planner / Subscriptions): search any real Dublin stop-to-stop journey and get a fully
editable itinerary (swap the mode per leg, insert a break and get an AI suggestion for
what to do), or use a guaranteed-working hardcoded sample route. Live disruption alerts
over WebSocket, an AI concierge (OpenRouter), and a real Stripe sandbox subscription.

## Setup

```bash
npm install                              # repo root - real transit data/planner
npm run gtfs:update                      # downloads + indexes the full timetable (~5 min, ~165 MB)
cd server && npm install && cp .env.example .env
cd ../client && npm install
```

Fill in `server/.env`:
- `OPENROUTER_API_KEY` — https://openrouter.ai/keys (chat works with a canned fallback
  reply if left blank, so the rest of the app still runs without it)
- `STRIPE_SECRET_KEY` — a **test mode** secret key from
  https://dashboard.stripe.com/test/apikeys (needed only for the Pro upgrade flow)

Fill in the repo-root `.env` (copy `.env.example`):
- `GTFS_FEED=GTFS_Realtime` — the full Dublin-wide feed (the default, `GTFS_Irish_Rail`,
  is a small rail-only feed meant for quick testing and won't have most bus/Luas stops)
- `NTA_API_KEY` — https://developer.nationaltransport.ie (optional; without it, live
  delay alerts fall back to the simulated feed, same pattern as the OpenRouter key)

## Run

Two terminals:

```bash
cd server && npm run dev   # http://localhost:4000
cd client && npm run dev   # http://localhost:5173
```

Open http://localhost:5173.

## What's real vs. mocked

- **Manual/Smart Planner search**: a real journey, computed by the Connection Scan
  planner in `src/planner.js` against the downloaded GTFS timetable, converted to this
  app's editable-leg shape by `server/src/services/plannerBridge.ts`. Real searched
  routes only ever have one option per leg (the planner returns one best route, not
  alternatives) — the "Try the sample UCD route" button loads the hand-curated demo
  corridor instead, which does have 2-3 alternatives per leg to demonstrate mode-swapping
  and the fastest/fewest-transfers/cheapest preference toggle.
- **Sample route data**: hand-entered from NTA's published schedules for one corridor
  (UCD Belfield -> city centre via Dundrum). See `server/src/data/corridor.ts`.
- **Live alerts**: real NTA GTFS-Realtime delay/cancellation events
  (`server/src/services/liveFeed.ts` via `src/nta.js`) when `NTA_API_KEY` is set;
  otherwise a simulated feed on the same polling cadence.
- **AI concierge**: a real OpenRouter call (`server/src/services/openrouter.ts`).
- **Stripe**: a real sandbox Checkout Session (subscription, test price) — use card
  `4242 4242 4242 4242`, any future expiry/CVC.

## Transit data & journey planner (repo root: `src/`, `scripts/`)

Real data for all of Ireland: static timetables (buses, rail, Luas), live trains, live bus
delays (NTA GTFS-Realtime), and an A -> B planner with stopovers. Run these from the repo root
after `npm install` there.

### Live data setup

1. Get a free API key at https://developer.nationaltransport.ie
2. Put it in `.env` (copy `.env.example`): `NTA_API_KEY=...`
3. `npm install`
4. Try it:
   - `npm run delays` — summary + most delayed trips
   - `npm run delays -- --stop <stop_id>` — live times at a stop
   - `npm run delays -- --route <route_id>` — live status of a route

`src/nta.js` exports `getTripUpdates()` and `getVehiclePositions()` (cached for 60s to respect the API rate limit).
Stop/route IDs are from the static GTFS feed: https://www.transportforireland.ie/transitData/PT_Data.html

### Journey planner (A -> B, with stopovers)

Plans across buses, trains and Luas using the timetable (`npm run gtfs:update` first).

- `npm run plan ucd heuston`
- `npm run plan ucd galway via athlone` — 2 hour stopover in Athlone (default)
- `npm run plan ucd galway via athlone stay 90` — custom stopover in minutes
- `npm run plan ucd cork via kildare stay 60 via limerick junction stay 30` — several stopovers, each with its own stay
- `npm run plan ucd dublin airport depart 08:30 date 2026-10-12`
- Add `json` for the raw result (for the frontend).

Options are plain words (`--via` also works in bash) and names need no quotes, because PowerShell + npm
drop `--` and split quoted arguments.
Places can be a stop name, a stop number or `lat,lon`. The first plan of each day takes ~20s to build
that day's connections into `data/cache/`; after that a plan takes under a second.
`src/planner.js` exports `planJourney({ from, to, vias, stayMins, depart, date })`.
It uses the Connection Scan Algorithm (earliest arrival, then leaves as late as possible for the same arrival),
with walking transfers up to 500 m between stops. Timetable only for now — live delays aren't used yet.

### Buses

Needs the timetable database first: `npm run gtfs:update` (downloads ~163 MB and builds `data/gtfs.db`, takes ~5 min).

- `npm run buses -- 768` — departures from a stop by the number on the pole
- `npm run buses -- ucd 30` — by name (all stops with that name), next 30 min
- Shows the timetable, plus live delays/cancellations when `NTA_API_KEY` works.
- `src/timetable.js` exports `findStops()`, `scheduledDepartures()` and `activeServices()`.

### Live trains (Irish Rail, no key needed)

The NTA feed only covers Dublin Bus, Bus Éireann and Go-Ahead, so trains/DART come from the Irish Rail API.

- `npm run trains` — trains running right now
- `npm run trains -- connolly` — live departures board (add a number for the window in minutes, e.g. `connolly 30`)
- `src/irishrail.js` exports `getStations()`, `findStations()`, `getStationBoard()` and `getCurrentTrains()`.

### Static timetable

- `npm run gtfs:update` downloads the feed named by `GTFS_FEED` in `.env` into `data/gtfs/` (git-ignored; TFI refreshes it nightly).
  `GTFS_Realtime` (default, 163 MB) covers all operators with the same IDs as the live feed; `GTFS_Irish_Rail` (8 MB) is a small one for quick tests.
- `npm run stops -- connolly` searches stops by name or code.
- `src/gtfs.js` exports `loadGtfs()` (stops/routes/trips as Maps), `readTable()` to stream any GTFS file, and `searchStops()`.
- `npm run delays` shows stop/route names instead of IDs once the timetable is downloaded.
