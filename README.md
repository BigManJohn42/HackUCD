# HackUCD
Journey planner for Irish public transport, with support for long stopovers between legs.

## Live data setup

1. Get a free API key at https://developer.nationaltransport.ie
2. Put it in `.env` (copy `.env.example`): `NTA_API_KEY=...`
3. `npm install`
4. Try it:
   - `npm run delays` — summary + most delayed trips
   - `npm run delays -- --stop <stop_id>` — live times at a stop
   - `npm run delays -- --route <route_id>` — live status of a route

`src/nta.js` exports `getTripUpdates()` and `getVehiclePositions()` (cached for 60s to respect the API rate limit).
Stop/route IDs are from the static GTFS feed: https://www.transportforireland.ie/transitData/PT_Data.html

## Journey planner (A -> B, with stopovers)

Plans across buses, trains and Luas using the timetable (`npm run gtfs:update` first).

- `npm run plan ucd heuston`
- `npm run plan ucd galway via athlone` — 2 hour stopover in Athlone (default)
- `npm run plan ucd galway via athlone stay 90` — custom stopover in minutes; `via` can repeat
- `npm run plan ucd dublin airport depart 08:30 date 2026-10-12`
- Add `json` for the raw result (for the frontend).

Options are plain words (`--via` also works in bash) and names need no quotes, because PowerShell + npm
drop `--` and split quoted arguments.
Places can be a stop name, a stop number or `lat,lon`. The first plan of each day takes ~20s to build
that day's connections into `data/cache/`; after that a plan takes under a second.
`src/planner.js` exports `planJourney({ from, to, vias, stayMins, depart, date })`.
It uses the Connection Scan Algorithm (earliest arrival, then leaves as late as possible for the same arrival),
with walking transfers up to 500 m between stops. Timetable only for now — live delays aren't used yet.

## Buses

Needs the timetable database first: `npm run gtfs:update` (downloads ~163 MB and builds `data/gtfs.db`, takes ~5 min).

- `npm run buses -- 768` — departures from a stop by the number on the pole
- `npm run buses -- ucd 30` — by name (all stops with that name), next 30 min
- Shows the timetable, plus live delays/cancellations when `NTA_API_KEY` works.
- `src/timetable.js` exports `findStops()`, `scheduledDepartures()` and `activeServices()`.

## Live trains (Irish Rail, no key needed)

The NTA feed only covers Dublin Bus, Bus Éireann and Go-Ahead, so trains/DART come from the Irish Rail API.

- `npm run trains` — trains running right now
- `npm run trains -- connolly` — live departures board (add a number for the window in minutes, e.g. `connolly 30`)
- `src/irishrail.js` exports `getStations()`, `findStations()`, `getStationBoard()` and `getCurrentTrains()`.

## Static timetable

- `npm run gtfs:update` downloads the feed named by `GTFS_FEED` in `.env` into `data/gtfs/` (git-ignored; TFI refreshes it nightly).
  `GTFS_Realtime` (default, 163 MB) covers all operators with the same IDs as the live feed; `GTFS_Irish_Rail` (8 MB) is a small one for quick tests.
- `npm run stops -- connolly` searches stops by name or code.
- `src/gtfs.js` exports `loadGtfs()` (stops/routes/trips as Maps), `readTable()` to stream any GTFS file, and `searchStops()`.
- `npm run delays` shows stop/route names instead of IDs once the timetable is downloaded.
