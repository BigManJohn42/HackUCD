import type { SavedRoute } from "../api";

export function SavedRoutesPanel({
  routes,
  onLoad,
  onDelete,
  loadingId,
}: {
  routes: SavedRoute[];
  onLoad: (route: SavedRoute) => void;
  onDelete: (route: SavedRoute) => void;
  loadingId: string | null;
}) {
  if (routes.length === 0) return null;

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Your saved routes</h2>
      <ul className="saved-routes-list">
        {routes.map((route) => (
          <li key={route.id} className="saved-route-row">
            <div>
              <p style={{ margin: 0, fontWeight: 600 }}>{route.name}</p>
              <p className="leg-meta" style={{ margin: 0 }}>
                {route.from} &rarr; {route.to}
                {route.stopovers.length > 0 ? ` (+${route.stopovers.length} stop${route.stopovers.length > 1 ? "s" : ""})` : ""}
              </p>
            </div>
            <div className="leg-actions">
              <button
                type="button"
                className="btn-primary"
                onClick={() => onLoad(route)}
                disabled={loadingId === route.id}
              >
                {loadingId === route.id ? "Planning..." : "Plan this again"}
              </button>
              <button type="button" className="btn-secondary" onClick={() => onDelete(route)}>
                Remove
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
