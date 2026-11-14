/** Straight-line distance on a sphere, not road travel time. */
export function distanceKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
) {
  const rad = Math.PI / 180;
  const a =
    Math.sin(((lat2 - lat1) * rad) / 2) ** 2 +
    Math.cos(lat1 * rad) *
      Math.cos(lat2 * rad) *
      Math.sin(((lng2 - lng1) * rad) / 2) ** 2;
  return 6371.0088 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, a))));
}
const validLocation = (lat: number | null, lng: number | null) =>
  lat !== null &&
  lng !== null &&
  Number.isFinite(lat) &&
  Number.isFinite(lng) &&
  Math.abs(lat) <= 90 &&
  Math.abs(lng) <= 180;
const eligible =
  "team_id IS NULL AND status!='resolved' AND assignment_state IN ('pending','needs_location','no_team')";
type Incident = {
  id: string;
  lat: number | null;
  lng: number | null;
  version: number;
};
type Team = { id: string; lat: number; lng: number; version: number };

export async function assignIncident(
  db: D1Database,
  id: string,
): Promise<boolean> {
  const incident = await db
    .prepare(
      `SELECT id,lat,lng,version FROM incidents WHERE id=? AND ${eligible}`,
    )
    .bind(id)
    .first<Incident>();
  if (!incident) return false;
  const now = new Date().toISOString();
  if (!validLocation(incident.lat, incident.lng)) {
    await db
      .prepare(
        `UPDATE incidents SET assignment_state='needs_location',assignment_checked_at=? WHERE id=? AND version=? AND ${eligible}`,
      )
      .bind(now, id, incident.version)
      .run();
    return false;
  }
  // Retry a changed team snapshot once. Each claim rechecks both records atomically.
  for (let round = 0; round < 2; round++) {
    const { results } = await db
      .prepare(
        "SELECT id,lat,lng,version FROM teams t WHERE available=1 AND lat IS NOT NULL AND lng IS NOT NULL AND NOT EXISTS (SELECT 1 FROM incidents i WHERE i.team_id=t.id AND i.status!='resolved')",
      )
      .all<Team>();
    const candidates = results
      .filter((t) => validLocation(t.lat, t.lng))
      .map((t) => ({
        ...t,
        distance: distanceKm(incident.lat!, incident.lng!, t.lat, t.lng),
      }))
      .sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id));
    if (!candidates.length) break;
    for (const team of candidates) {
      const result = await db
        .prepare(
          `UPDATE incidents SET team_id=?,assignment_state='assigned',assigned_at=?,assignment_checked_at=?,assignment_distance_km=?,version=version+1 WHERE id=? AND version=? AND ${eligible} AND EXISTS (SELECT 1 FROM teams WHERE id=? AND version=? AND available=1) AND NOT EXISTS (SELECT 1 FROM incidents WHERE team_id=? AND status!='resolved' AND id!=?)`,
        )
        .bind(
          team.id,
          now,
          now,
          team.distance,
          id,
          incident.version,
          team.id,
          team.version,
          team.id,
          id,
        )
        .run();
      // SQL trigger writes the activity and notification in this same transaction.
      if (result.meta.changes) return true;
    }
  }
  await db
    .prepare(
      `UPDATE incidents SET assignment_state='no_team',assignment_checked_at=? WHERE id=? AND version=? AND ${eligible}`,
    )
    .bind(now, id, incident.version)
    .run();
  return false;
}

export async function assignWaitingIncidents(db: D1Database) {
  // Rotate checked rows so a blocked incident cannot starve the rest of the backlog.
  const { results } = await db
    .prepare(
      `SELECT id FROM incidents WHERE ${eligible} AND lat IS NOT NULL AND lng IS NOT NULL ORDER BY assignment_checked_at IS NOT NULL,COALESCE(assignment_checked_at,created_at),created_at,id LIMIT 25`,
    )
    .all<{ id: string }>();
  let assigned = 0;
  for (const incident of results)
    if (await assignIncident(db, incident.id)) assigned++;
  await db
    .prepare(
      "INSERT INTO job_runs(id,last_run,details) VALUES('assignment',?,?) ON CONFLICT(id) DO UPDATE SET last_run=excluded.last_run,details=excluded.details",
    )
    .bind(
      new Date().toISOString(),
      `Checked ${results.length} reports; assigned ${assigned}. Nearest available team by straight-line distance.`,
    )
    .run();
  return assigned;
}
