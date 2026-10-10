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
