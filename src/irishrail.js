// Client for the Irish Rail realtime API (no key needed). Covers trains and DART,
// which the NTA GTFS-R feed does not. Docs: https://api.irishrail.ie/realtime/
import { XMLParser } from "fast-xml-parser";

const BASE_URL = "http://api.irishrail.ie/realtime/realtime.asmx";
const parser = new XMLParser({ parseTagValue: false, trimValues: true });

async function call(method, params = {}) {
  const url = `${BASE_URL}/${method}?${new URLSearchParams(params)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Irish Rail ${method} failed: ${res.status} ${res.statusText}`);
  const doc = parser.parse(await res.text());
  // Response is <ArrayOfX><x/>...</ArrayOfX>; normalise to an array of the inner records.
  const root = Object.values(doc).find((v) => typeof v === "object") ?? {};
  const items = Object.entries(root).find(([k]) => !k.startsWith("@_"))?.[1] ?? [];
  return Array.isArray(items) ? items : [items];
}

const num = (v) => (v === "" || v == null ? null : Number(v));
const str = (v) => (v === "" || v == null ? null : String(v).trim());

let stationsPromise;

/** All stations: { code, name, alias, lat, lon }. Cached for the process lifetime. */
export function getStations() {
  stationsPromise ??= call("getAllStationsXML")
    .then((rows) =>
      rows.map((s) => ({
        code: str(s.StationCode),
        name: str(s.StationDesc),
        alias: str(s.StationAlias),
        lat: num(s.StationLatitude),
        lon: num(s.StationLongitude),
      })),
    )
    .catch((err) => {
      stationsPromise = undefined;
      throw err;
    });
  return stationsPromise;
}

/** Find stations by code (exact) or name/alias (substring), case-insensitive. */
export async function findStations(query) {
  const q = query.trim().toLowerCase();
  const stations = await getStations();
  const byCode = stations.filter((s) => s.code?.toLowerCase() === q);
  if (byCode.length) return byCode;
  return stations.filter((s) => s.name?.toLowerCase().includes(q) || s.alias?.toLowerCase().includes(q));
}

/**
 * Trains due at a station within the next `minutes` (5-90).
 * lateMins is minutes behind schedule (negative = early). Times are "HH:MM" strings, Irish local time.
 */
export async function getStationBoard(stationCode, minutes = 90) {
  const rows = await call("getStationDataByCodeXML_WithNumMins", { StationCode: stationCode, NumMins: minutes });
  return rows
    .map((r) => ({
      trainCode: str(r.Traincode),
      type: str(r.Traintype),
      origin: str(r.Origin),
      destination: str(r.Destination),
      direction: str(r.Direction),
      status: str(r.Status),
      lastLocation: str(r.Lastlocation),
      dueInMins: num(r.Duein),
      lateMins: num(r.Late),
      schArrival: str(r.Scharrival),
      schDepart: str(r.Schdepart),
      expArrival: str(r.Exparrival),
      expDepart: str(r.Expdepart),
      // O = starts here, D = terminates here, S = stops, T = passes through without stopping
      locationType: str(r.Locationtype),
    }))
    .sort((a, b) => (a.dueInMins ?? 0) - (b.dueInMins ?? 0));
}

/** Trains currently running (or about to), with live positions. */
export async function getCurrentTrains() {
  const rows = await call("getCurrentTrainsXML");
  return rows.map((t) => ({
    trainCode: str(t.TrainCode),
    running: str(t.TrainStatus) === "R", // N = not yet departed
    lat: num(t.TrainLatitude),
    lon: num(t.TrainLongitude),
    direction: str(t.Direction),
    message: str(t.PublicMessage)?.replace(/\\n/g, " | ") ?? null,
  }));
}
