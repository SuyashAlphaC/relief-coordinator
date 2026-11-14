import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { consumeEvent, flushOutbox, scanEscalations } from "../cloud/jobs.ts";
function setup() {
  const sqlite = new DatabaseSync(":memory:");
  for (const file of readdirSync("drizzle")
    .filter((f) => f.endsWith(".sql"))
    .sort())
    sqlite.exec(readFileSync(`drizzle/${file}`, "utf8"));
  const statement = (sql: string, values: any[] = []) => ({
    bind(...v: any[]) {
      return statement(sql, v);
    },
    async first() {
      return sqlite.prepare(sql).get(...values) || null;
    },
    async all() {
      return { results: sqlite.prepare(sql).all(...values) };
    },
    async run() {
      const r = sqlite.prepare(sql).run(...values);
      return { meta: { changes: Number(r.changes) } };
    },
    _sql: sql,
    _values: values,
  });
  const db = {
    prepare: statement,
    async batch(statements: any[]) {
      sqlite.exec("BEGIN");
      try {
        const results = statements.map((s) => {
          const r = sqlite.prepare(s._sql).run(...s._values);
          return { meta: { changes: Number(r.changes) } };
        });
        sqlite.exec("COMMIT");
        return results;
      } catch (e) {
        sqlite.exec("ROLLBACK");
        throw e;
      }
    },
  };
  const sent: any[] = [];
  const env: any = {
    DB: db,
    EVENTS: {
      async send(v: any) {
        sent.push(v);
      },
    },
    ROOMS: {
      idFromName: (id: string) => id,
      get: () => ({ fetch: async () => new Response("ok") }),
    },
  };
  return { sqlite, env, sent };
}
const seed = (db: DatabaseSync) =>
  db.exec(
    "INSERT INTO incidents(id,title,type,severity,location,description,created_by,created_at) VALUES('i','River flood','Flood','critical','Patna','Simulated incident','u','2020-01-01T00:00:00.000Z'); INSERT INTO resources(id,name,unit,quantity,location) VALUES('r','Water','litres',5,'Depot'); INSERT INTO requests(id,incident_id,resource_id,quantity,created_by,created_at) VALUES('q','i','r',2,'u','2020-01-01T00:00:00.000Z')",
  );
test("activity and outbox commit together; rollback cannot publish an event", () => {
  const { sqlite } = setup();
  sqlite.exec(
    "BEGIN; INSERT INTO activity VALUES('a','User','Reported incident','now'); ROLLBACK;",
  );
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM outbox").get()!.n, 0);
  sqlite.exec(
    "INSERT INTO activity VALUES('a','User','Reported incident','now')",
  );
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM outbox").get()!.n, 1);
});
test("queue delivery creates one notification even with duplicate delivery", async () => {
  const { sqlite, env } = setup();
  seed(sqlite);
  sqlite.exec(
    "INSERT INTO activity VALUES('i','User','Reported River flood','now')",
  );
  await consumeEvent(env, "i");
  await consumeEvent(env, "i");
  assert.equal(
    sqlite.prepare("SELECT COUNT(*) n FROM notifications").get()!.n,
    1,
  );
  assert(sqlite.prepare("SELECT processed_at FROM outbox").get()!.processed_at);
});
test("failed queue send keeps the event retryable", async () => {
  const { sqlite, env, sent } = setup();
  sqlite.exec(
    "INSERT INTO activity VALUES('a','User','Updated incident','now')",
  );
  env.EVENTS.send = async () => {
    throw new Error("offline");
  };
  await assert.rejects(flushOutbox(env), /offline/);
  assert.equal(
    sqlite.prepare("SELECT sent_at FROM outbox").get()!.sent_at,
    null,
  );
  env.EVENTS.send = async (v: any) => sent.push(v);
  assert.equal(await flushOutbox(env), 1);
  assert.equal(sent.length, 1);
});
test("scheduled checks identify all three conditions without duplicate alerts", async () => {
  const { sqlite, env, sent } = setup();
  seed(sqlite);
  assert.equal(await scanEscalations(env), 3);
  assert.equal(await scanEscalations(env), 0);
  for (const event of sent) await consumeEvent(env, event.id);
  assert.equal(
    sqlite.prepare("SELECT COUNT(*) n FROM notifications").get()!.n,
    3,
  );
  assert.equal(
    sqlite
      .prepare("SELECT COUNT(*) n FROM job_runs WHERE id='escalations'")
      .get()!.n,
    1,
  );
});
test("recent reports, assigned incidents, and sufficient inventory do not escalate", async () => {
  const { sqlite, env } = setup();
  seed(sqlite);
  sqlite.exec(
    "INSERT INTO teams(id,name,specialty,personnel,location) VALUES('t','Test team','Rescue',3,'Depot'); UPDATE incidents SET team_id='t'; UPDATE requests SET created_at='2999-01-01'; UPDATE resources SET quantity=100;",
  );
  assert.equal(await scanEscalations(env), 0);
});
test("attachments enforce per-incident cap and preserve existing records", () => {
  const { sqlite } = setup();
  seed(sqlite);
  const s = sqlite.prepare(
    "INSERT INTO attachments(id,incident_id,name,content_type,size,created_by,created_at) VALUES(?,'i','photo.png','image/png',20,'u','now')",
  );
  for (let i = 0; i < 20; i++) s.run(String(i));
  assert.throws(() => s.run("overflow"), /ATTACHMENT_LIMIT/);
  assert.equal(
    sqlite.prepare("SELECT COUNT(*) n FROM attachments").get()!.n,
    20,
  );
});
test("last coordinator cannot be demoted after another coordinator is removed", () => {
  const { sqlite } = setup();
  sqlite.exec(
    "INSERT INTO members VALUES('a','A','coordinator'),('b','B','coordinator'); UPDATE members SET role='reporter' WHERE id='a';",
  );
  assert.throws(
    () => sqlite.exec("UPDATE members SET role='reporter' WHERE id='b'"),
    /LAST_COORDINATOR/,
  );
});

test("cloud gateway enforces member roles and attachment ownership", async () => {
  const { cloudGateway } = await import("../lib/cloud-gateway.ts");
  const { sqlite, env } = setup();
  seed(sqlite);
  sqlite.exec(
    "INSERT INTO members(id,name,role) VALUES('owner','Owner','coordinator'),('reporter','Reporter','reporter'),('responder','Responder','responder')",
  );
  env.CLOUD = { fetch: async () => new Response("ok") };
  const request = (path: string, user: string, method = "POST") =>
    new Request("https://app.test" + path, {
      method,
      headers: {
        "oai-authenticated-user-id": user,
        origin: "https://app.test",
      },
    });
  assert.equal(
    (await cloudGateway(request("/api/cloud/scan", "reporter"), env)).status,
    403,
  );
  assert.equal(
    (await cloudGateway(request("/api/cloud/scan", "responder"), env)).status,
    403,
  );
  assert.equal(
    (await cloudGateway(request("/api/cloud/scan", "owner"), env)).status,
    200,
  );
  assert.equal(
    (
      await cloudGateway(
        request("/api/cloud/acknowledge?id=test", "reporter"),
        env,
      )
    ).status,
    403,
  );
  const file = "11111111-1111-4111-8111-111111111111";
  sqlite
    .prepare(
      "INSERT INTO attachments(id,incident_id,name,content_type,size,created_by,created_at,status) VALUES(?,'i','test.png','image/png',8,'owner','now','ready')",
    )
    .run(file);
  assert.equal(
    (
      await cloudGateway(
        request("/api/cloud/files/" + file, "reporter", "DELETE"),
        env,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await cloudGateway(
        request("/api/cloud/files/" + file, "responder", "DELETE"),
        env,
      )
    ).status,
    403,
  );
  assert.equal(
    sqlite.prepare("SELECT status FROM attachments WHERE id=?").get(file)!
      .status,
    "ready",
  );
  assert.equal(
    (
      await cloudGateway(
        request("/api/cloud/files/" + file, "reporter", "GET"),
        env,
      )
    ).status,
    200,
  );
});
