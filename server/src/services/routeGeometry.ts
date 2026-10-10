// Real road-following paths between two points, via OSRM's public demo
// routing server (no API key needed). The public demo instance only hosts
// the "driving" road network - there's no free-tier pedestrian/cycle profile
// without an API key - so this traces actual roads rather than a literal
// straight line, but isn't a true footpath for walk legs. Good enough to
// replace a straight-line guess; not as accurate as the GTFS-operated shape
// for transit legs, which would need shapes.txt indexed (it isn't yet).
const OSRM_URL = "https://router.project-osrm.org/route/v1/driving";
const TIMEOUT_MS = 4000;

const cache = new Map<string, [number, number][] | null>();

function cacheKey(from: [number, number], to: [number, number]): string {
  const round = (n: number) => n.toFixed(4);
  return `${round(from[0])},${round(from[1])}-${round(to[0])},${round(to[1])}`;
}

export async function fetchRoutePath(
  from: [number, number],
  to: [number, number]
): Promise<[number, number][] | null> {
  const key = cacheKey(from, to);
  if (cache.has(key)) return cache.get(key)!;

  try {
    const url = `${OSRM_URL}/${from[1]},${from[0]};${to[1]},${to[0]}?overview=full&geometries=geojson`;
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`OSRM ${res.status}`);
    const data = (await res.json()) as { routes?: { geometry?: { coordinates?: [number, number][] } }[] };
    const coords = data.routes?.[0]?.geometry?.coordinates;
    if (!coords?.length) throw new Error("no route geometry");
    // GeoJSON is [lon, lat]; this app uses [lat, lon] everywhere else.
    const points: [number, number][] = coords.map(([lon, lat]: [number, number]) => [lat, lon]);
    cache.set(key, points);
    return points;
  } catch {
    cache.set(key, null); // don't hammer OSRM retrying a pair it can't route
    return null;
  }
}
