import L from "leaflet";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";
import { useEffect, useMemo, useState } from "react";
import { CircleMarker, MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from "react-leaflet";
import type { Corridor, Mode } from "../types";

// Vite serves these as hashed asset URLs; Leaflet's default icon otherwise
// resolves relative paths that break once bundled.
delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

const MODE_COLOR: Record<Mode, string> = {
  walk: "#65675f",
  bus: "#588157",
  luas: "#2e7fb8",
  rail: "#2e7fb8",
  cycle: "#b8860b",
  stay: "#9c6644",
};

interface StopPoint {
  name: string;
  coords: [number, number];
  isTransferPoint: boolean;
}

function FitToStops({ points }: { points: StopPoint[] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    const bounds = L.latLngBounds(points.map((p) => p.coords));
    map.fitBounds(bounds, { padding: [32, 32] });
  }, [map, points]);
  return null;
}

interface Segment {
  legId: string;
  positions: [number, number][];
  color: string;
  label: string;
}

// Keyed by position pair, not just legId - legIds are reused across different
// searches (e.g. "leg-0-0"), so a position-based key stops a brand-new search
// from briefly flashing a previous, unrelated journey's cached path.
const segKey = (seg: Segment) => `${seg.positions[0]?.join(",")}|${seg.positions[1]?.join(",")}`;

/** Real road-following paths per segment, fetched from the server (which proxies
 * OSRM) instead of drawing a straight line between the two stops. Falls back to
 * the straight line - already in `positions` - while loading or if a pair can't
 * be routed. */
function useRealPaths(segments: Segment[]): Record<string, [number, number][]> {
  const [paths, setPaths] = useState<Record<string, [number, number][]>>({});

  useEffect(() => {
    let cancelled = false;
    segments.forEach((seg) => {
      const [from, to] = seg.positions;
      if (!from || !to || (from[0] === to[0] && from[1] === to[1])) return; // stopovers etc.
      const key = segKey(seg);
      const params = new URLSearchParams({
        from: `${from[0]},${from[1]}`,
        to: `${to[0]},${to[1]}`,
      });
      fetch(`/api/route-path?${params}`)
        .then((r) => (r.ok ? r.json() : { points: [] }))
        .then((data: { points?: [number, number][] }) => {
          if (cancelled || !data.points?.length) return;
          setPaths((prev) => ({ ...prev, [key]: data.points! }));
        })
        .catch(() => {});
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segments.map((s) => segKey(s)).join("|")]);

  return paths;
}

function MyLocationMarker({ enabled }: { enabled: boolean }) {
  const [position, setPosition] = useState<[number, number] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !navigator.geolocation) return;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        setError(null);
        setPosition([pos.coords.latitude, pos.coords.longitude]);
      },
      () => setError("Location unavailable - check your browser's location permission."),
      { enableHighAccuracy: true, maximumAge: 10_000 }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [enabled]);

  if (!enabled) return null;
  if (error) return null;
  if (!position) return null;

  return (
    <CircleMarker
      center={position}
      radius={8}
      pathOptions={{ color: "#1a73e8", fillColor: "#1a73e8", fillOpacity: 0.9, weight: 2 }}
    >
      <Popup>You are here</Popup>
    </CircleMarker>
  );
}

export function RouteMap({
  corridor,
  selections,
  myLocationEnabled,
}: {
  corridor: Corridor;
  selections: Record<string, string>;
  myLocationEnabled: boolean;
}) {
  const stops: StopPoint[] = useMemo(() => {
    const seen = new Set<string>();
    const result: StopPoint[] = [];
    corridor.legs.forEach((leg) => {
      for (const name of [leg.from, leg.to]) {
        if (seen.has(name)) continue;
        const coords = corridor.stopCoords[name];
        if (!coords) continue;
        seen.add(name);
        result.push({ name, coords, isTransferPoint: leg.isTransferPoint && name === leg.to });
      }
    });
    return result;
  }, [corridor]);

  const segments = useMemo(
    () =>
      corridor.legs
        .map((leg) => {
          const from = corridor.stopCoords[leg.from];
          const to = corridor.stopCoords[leg.to];
          if (!from || !to) return null;
          const selected = leg.options.find((o) => o.id === selections[leg.id]) ?? leg.options[0];
          return { legId: leg.id, positions: [from, to] as [number, number][], color: MODE_COLOR[selected.mode], label: selected.label };
        })
        .filter((s): s is NonNullable<typeof s> => s !== null),
    [corridor, selections]
  );

  const realPaths = useRealPaths(segments);

  if (stops.length === 0) return null;

  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      <MapContainer
        center={stops[0].coords}
        zoom={13}
        style={{ height: "320px", width: "100%" }}
        scrollWheelZoom={false}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FitToStops points={stops} />
        {segments.map((seg) => (
          <Polyline
            key={seg.legId}
            positions={realPaths[segKey(seg)] ?? seg.positions}
            pathOptions={{ color: seg.color, weight: 5, opacity: 0.85 }}>
            <Popup>{seg.label}</Popup>
          </Polyline>
        ))}
        {stops.map((stop) => (
          <Marker key={stop.name} position={stop.coords}>
            <Popup>
              {stop.name}
              {stop.isTransferPoint ? " (transfer point)" : ""}
            </Popup>
          </Marker>
        ))}
        <MyLocationMarker enabled={myLocationEnabled} />
      </MapContainer>
    </div>
  );
}
