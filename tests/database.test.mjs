import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
function setup() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync("drizzle/0000_goofy_nightcrawler.sql", "utf8"));
  db.exec(readFileSync("drizzle/0001_coordination_guards.sql", "utf8"));
  db.exec(
    "INSERT INTO incidents (id,title,type,severity,location,description,created_by,created_at) VALUES ('i','Test','Flood','high','Test','Description','u','now'); INSERT INTO resources (id,name,unit,quantity,location) VALUES ('r','Water','litres',10,'Depot'); INSERT INTO requests(id,incident_id,resource_id,quantity,created_by,created_at) VALUES ('q','i','r',6,'u','now')",
  );
  return db;
}
test("dispatch deducts inventory exactly once and increments resource version", () => {
  const db = setup();
  db.exec(
    "UPDATE requests SET status='fulfilled' WHERE id='q' AND status='pending'",
  );
  db.exec(
    "UPDATE requests SET status='fulfilled' WHERE id='q' AND status='pending'",
  );
  assert.equal(db.prepare("SELECT quantity FROM resources").get().quantity, 4);
  assert.equal(db.prepare("SELECT version FROM resources").get().version, 2);
});
test("competing requests cannot overdraw stock; failed dispatch rolls back", () => {
  const db = setup();
  db.exec(
    "INSERT INTO requests(id,incident_id,resource_id,quantity,created_by,created_at) VALUES ('q2','i','r',6,'u','now'); UPDATE requests SET status='fulfilled' WHERE id='q'",
  );
  assert.throws(
    () => db.exec("UPDATE requests SET status='fulfilled' WHERE id='q2'"),
    /INSUFFICIENT_STOCK/,
  );
  assert.equal(
    db.prepare("SELECT status FROM requests WHERE id='q2'").get().status,
    "pending",
  );
  assert.equal(db.prepare("SELECT quantity FROM resources").get().quantity, 4);
});
test("pending requests block resolution; cancellation does not consume stock", () => {
  const db = setup();
  assert.throws(
    () => db.exec("UPDATE incidents SET status='resolved'"),
    /PENDING_REQUESTS/,
  );
  db.exec(
    "UPDATE requests SET status='cancelled'; UPDATE incidents SET status='resolved'",
  );
  assert.equal(db.prepare("SELECT quantity FROM resources").get().quantity, 10);
  assert.throws(
    () =>
      db.exec(
        "INSERT INTO requests(id,incident_id,resource_id,quantity,created_by,created_at) VALUES ('q2','i','r',1,'u','now')",
      ),
    /INCIDENT_RESOLVED/,
  );
});
test("negative inventory and inventory overflow are rejected", () => {
  const db = setup();
  assert.throws(
    () => db.exec("UPDATE resources SET quantity=-1"),
    /INVALID_STOCK/,
  );
  assert.throws(
    () => db.exec("UPDATE resources SET quantity=1000001"),
    /INVALID_STOCK/,
  );
});
test("foreign keys reject missing resources", () => {
  const db = setup();
  assert.throws(
    () =>
      db.exec(
        "INSERT INTO requests(id,incident_id,resource_id,quantity,created_by,created_at) VALUES ('q2','i','missing',1,'u','now')",
      ),
    /FOREIGN KEY/,
  );
});
test("optimistic locking prevents lost updates", () => {
  const db = setup();
  assert.equal(
    db
      .prepare(
        "UPDATE incidents SET title='first',version=version+1 WHERE id='i' AND version=1",
      )
      .run().changes,
    1,
  );
  assert.equal(
    db
      .prepare(
        "UPDATE incidents SET title='stale',version=version+1 WHERE id='i' AND version=1",
      )
      .run().changes,
    0,
  );
  assert.equal(db.prepare("SELECT title FROM incidents").get().title, "first");
});
