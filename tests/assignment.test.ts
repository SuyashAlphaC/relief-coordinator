import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import {
  assignIncident,
  assignWaitingIncidents,
  distanceKm,
} from "../lib/auto-assignment.ts";
function setup() {
  const sql = new DatabaseSync(":memory:");
  for (const name of readdirSync("drizzle")
    .filter((n) => n.endsWith(".sql"))
    .sort())
    sql.exec(readFileSync(`drizzle/${name}`, "utf8"));
  let beforeRun: ((query: string) => void) | undefined;
  const statement = (query: string, values: any[] = []): any => ({
    bind: (...args: any[]) => statement(query, args),
    first: async () => sql.prepare(query).get(...values) || null,
    all: async () => ({ results: sql.prepare(query).all(...values) }),
    run: async () => {
      beforeRun?.(query);
      return {
        meta: { changes: Number(sql.prepare(query).run(...values).changes) },
      };
    },
  });
  const db = { prepare: statement } as unknown as D1Database;
  const incident = (
    id: string,
    lat: number | null = 0,
    lng: number | null = 0,
    state = "pending",
  ) =>
    sql
      .prepare(
        "INSERT INTO incidents(id,title,type,severity,location,lat,lng,description,created_by,created_at,assignment_state) VALUES(?,?,'Flood','critical','Test',?,?,'Test report','u','2026-01-01',?)",
      )
      .run(id, id, lat, lng, state);
  const team = (
    id: string,
    lat: number | null = 0,
    lng: number | null = 0,
    available = 1,
  ) =>
    sql
      .prepare(
        "INSERT INTO teams(id,name,specialty,personnel,location,lat,lng,available) VALUES(?,?,'Rescue',5,'Base',?,?,?)",
      )
      .run(id, id, lat, lng, available);
  const get = (id: string) =>
    sql.prepare("SELECT * FROM incidents WHERE id=?").get(id)!;
  return {
    sql,
    db,
    incident,
    team,
    get,
    intercept: (fn: (q: string) => void) => {
      beforeRun = fn;
    },
  };
}
test("great-circle distance handles zero, dateline, antipodes and known distance", () => {
  assert.equal(distanceKm(0, 0, 0, 0), 0);
  assert.ok(Math.abs(distanceKm(0, 0, 0, 1) - 111.195) < 0.01);
  assert.ok(distanceKm(0, 179.9, 0, -179.9) < 23);
  assert.ok(Math.abs(distanceKm(0, 0, 0, 180) - 20015.114) < 0.01);
});
test("nearest available team assigned once with atomic audit, notification, version and timestamp", async () => {
  const { db, sql, incident, team, get } = setup();
  incident("i");
  team("far", 0, 2);
  team("near", 0, 0.01);
  team("off", 0, 0, 0);
  team("unknown", null, null);
  assert.equal(await assignIncident(db, "i"), true);
  const row = get("i");
  assert.equal(row.team_id, "near");
  assert.equal(row.status, "reported");
  assert.equal(row.version, 2);
  assert.equal(row.assignment_state, "assigned");
  assert.ok(row.assigned_at);
  assert.ok(Number(row.assignment_distance_km) < 1.2);
  assert.equal(await assignIncident(db, "i"), false);
  assert.equal(sql.prepare("SELECT COUNT(*) n FROM activity").get()!.n, 1);
  assert.equal(sql.prepare("SELECT COUNT(*) n FROM notifications").get()!.n, 1);
  assert.equal(sql.prepare("SELECT COUNT(*) n FROM outbox").get()!.n, 1);
});
test("concurrent reports cannot double-book one team; release allows waiting report to recover", async () => {
  const { db, sql, incident, team, get } = setup();
  team("only");
  incident("a");
  incident("b");
  const results = await Promise.all([
    assignIncident(db, "a"),
    assignIncident(db, "b"),
  ]);
  assert.equal(results.filter(Boolean).length, 1);
  const assigned = get("a").team_id ? "a" : "b",
    waiting = assigned === "a" ? "b" : "a";
  assert.equal(get(waiting).assignment_state, "no_team");
  assert.throws(
    () =>
      sql
        .prepare("UPDATE incidents SET team_id='only' WHERE id=?")
        .run(waiting),
    /TEAM_BUSY/,
  );
  sql
    .prepare(
      "UPDATE incidents SET status='resolved',version=version+1 WHERE id=?",
    )
    .run(assigned);
  assert.equal(await assignWaitingIncidents(db), 1);
  assert.equal(get(waiting).team_id, "only");
});
test("missing coordinates, legacy and resolved incidents never get guessed assignments", async () => {
  const { db, sql, incident, team, get } = setup();
  team("t");
  incident("missing", null, null);
  incident("legacy", 0, 0, "manual");
  incident("closed");
  sql.exec("UPDATE incidents SET status='resolved' WHERE id='closed'");
  for (const id of ["missing", "legacy", "closed"])
    assert.equal(await assignIncident(db, id), false);
  assert.equal(get("missing").assignment_state, "needs_location");
  assert.equal(get("legacy").assignment_state, "manual");
  sql.exec(
    "UPDATE incidents SET lat=0,lng=0,assignment_state='pending',version=version+1 WHERE id='missing'",
  );
  assert.equal(await assignIncident(db, "missing"), true);
});
test("manual assignment racing automatic claim wins without being overwritten", async () => {
  const { db, sql, incident, team, get, intercept } = setup();
  incident("i");
  team("auto");
  team("manual", 0, 2);
  let injected = false;
  intercept((q) => {
    if (!injected && q.includes("assignment_state='assigned'")) {
      injected = true;
      sql.exec(
        "UPDATE incidents SET team_id='manual',assignment_state='manual',version=version+1 WHERE id='i'",
      );
    }
  });
  assert.equal(await assignIncident(db, "i"), false);
  assert.equal(get("i").team_id, "manual");
  assert.equal(get("i").assignment_state, "manual");
  assert.equal(sql.prepare("SELECT COUNT(*) n FROM notifications").get()!.n, 0);
});
test("changing availability during a claim skips that team and selects next nearest", async () => {
  const { db, sql, incident, team, get, intercept } = setup();
  incident("i");
  team("near");
  team("next", 0, 1);
  let injected = false;
  intercept((q) => {
    if (!injected && q.includes("assignment_state='assigned'")) {
      injected = true;
      sql.exec(
        "UPDATE teams SET available=0,version=version+1 WHERE id='near'",
      );
    }
  });
  assert.equal(await assignIncident(db, "i"), true);
  assert.equal(get("i").team_id, "next");
});
test("notification failure rolls back assignment and later scan recovers it", async () => {
  const { db, sql, incident, team, get } = setup();
  incident("i");
  team("t");
  sql.exec(
    "CREATE TRIGGER fail_notice BEFORE INSERT ON notifications BEGIN SELECT RAISE(ABORT,'temporary'); END;",
  );
  await assert.rejects(assignIncident(db, "i"), /temporary/);
  assert.equal(get("i").team_id, null);
  assert.equal(sql.prepare("SELECT COUNT(*) n FROM activity").get()!.n, 0);
  sql.exec("DROP TRIGGER fail_notice");
  assert.equal(await assignWaitingIncidents(db), 1);
  assert.equal(get("i").team_id, "t");
});
test("equal-distance tie is deterministic; existing busy teams are excluded", async () => {
  const { db, incident, team, get } = setup();
  team("b");
  team("a");
  incident("first");
  incident("second");
  await assignIncident(db, "first");
  await assignIncident(db, "second");
  assert.equal(get("first").team_id, "a");
  assert.equal(get("second").team_id, "b");
});
test("SQL guards reject invalid team coordinates and off-duty manual assignments", () => {
  const { sql, incident, team } = setup();
  assert.throws(() => team("bad", 91, 0), /INVALID_TEAM_LOCATION/);
  assert.throws(() => team("partial", null, 0), /INVALID_TEAM_LOCATION/);
  team("off", 0, 0, 0);
  incident("i");
  assert.throws(
    () => sql.exec("UPDATE incidents SET team_id='off' WHERE id='i'"),
    /TEAM_UNAVAILABLE/,
  );
});
test("migration preserves legacy records and existing duplicate allocations without reassigning them", () => {
  const sql = new DatabaseSync(":memory:");
  const files = readdirSync("drizzle")
    .filter((n) => n.endsWith(".sql"))
    .sort();
  for (const f of files.filter((n) => n < "0006"))
    sql.exec(readFileSync(`drizzle/${f}`, "utf8"));
  sql.exec(
    "INSERT INTO teams VALUES('t','Legacy','Rescue',3,'Patna'); INSERT INTO incidents(id,title,type,severity,location,description,team_id,created_by,created_at) VALUES('a','Old A','Flood','high','Patna','Old report','t','u','2020'),('b','Old B','Flood','high','Patna','Old report','t','u','2020')",
  );
  for (const f of files.filter((n) => n >= "0006"))
    sql.exec(readFileSync(`drizzle/${f}`, "utf8"));
  assert.equal(
    sql
      .prepare(
        "SELECT COUNT(*) n FROM incidents WHERE team_id='t' AND assignment_state='manual'",
      )
      .get()!.n,
    2,
  );
  assert.equal(
    sql.prepare("SELECT lat FROM teams WHERE id='t'").get()!.lat,
    null,
  );
});
