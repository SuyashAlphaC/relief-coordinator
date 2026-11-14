import type { CloudEnv } from "./types";
export async function broadcast(env: CloudEnv, room = "workspace") {
  const response = await env.ROOMS.get(env.ROOMS.idFromName(room)).fetch(
    "https://room/broadcast",
    { method: "POST" },
  );
  if (!response.ok) throw new Error("Live update delivery failed");
}
export async function flushOutbox(env: CloudEnv) {
  const cutoff = new Date(Date.now() - 60000).toISOString();
  const { results } = await env.DB.prepare(
    "SELECT id FROM outbox WHERE processed_at IS NULL AND (sent_at IS NULL OR sent_at<?) ORDER BY created_at LIMIT 20",
  )
    .bind(cutoff)
    .all<{ id: string }>();
  for (const row of results) {
    await env.EVENTS.send({ id: row.id });
    await env.DB.prepare("UPDATE outbox SET sent_at=? WHERE id=?")
      .bind(new Date().toISOString(), row.id)
      .run();
  }
  return results.length;
}
export async function consumeEvent(env: CloudEnv, id: string) {
  const row = await env.DB.prepare("SELECT * FROM outbox WHERE id=?")
    .bind(id)
    .first<{
      id: string;
      kind: string;
      payload: string;
      processed_at: string | null;
    }>();
  if (!row || row.processed_at) return;
  const data = JSON.parse(row.payload);
  let notice: null | {
    kind: string;
    title: string;
    body: string;
    entity: string | null;
  } = null;
  if (row.kind === "activity") {
    const incident = await env.DB.prepare(
      "SELECT id,title,location FROM incidents WHERE id=? AND severity='critical' AND status!='resolved'",
    )
      .bind(id)
      .first<{ id: string; title: string; location: string }>();
    if (incident)
      notice = {
        kind: "critical",
        title: "Critical incident reported",
        body: `${incident.title} · ${incident.location}`,
        entity: incident.id,
      };
    else if (data.message === "Dispatched relief supplies")
      notice = {
        kind: "dispatch",
        title: "Relief supplies dispatched",
        body: `${data.actor} confirmed a supply dispatch.`,
        entity: null,
      };
  } else if (row.kind === "alert") notice = data;
  const now = new Date().toISOString();
  const statements = [];
  if (notice)
    statements.push(
      env.DB.prepare(
        "INSERT OR IGNORE INTO notifications(id,kind,title,body,entity_id,created_at) VALUES(?,?,?,?,?,?)",
      ).bind(id, notice.kind, notice.title, notice.body, notice.entity, now),
    );
  statements.push(
    env.DB.prepare("UPDATE outbox SET processed_at=? WHERE id=?").bind(now, id),
  );
  await env.DB.batch(statements);
  // A failed broadcast is recovered by the browser's state refresh; the committed notification remains durable.
  await broadcast(env).catch((e) =>
    console.error("Notification live update unavailable", String(e)),
  );
}
export async function scanEscalations(env: CloudEnv, now = new Date()) {
  const time = now.toISOString(),
    incidentCutoff = new Date(now.getTime() - 30 * 60000).toISOString(),
    requestCutoff = new Date(now.getTime() - 60 * 60000).toISOString();
  const results = await env.DB.batch([
    env.DB.prepare(
      "INSERT OR IGNORE INTO outbox(id,kind,payload,created_at) SELECT 'unassigned:'||id,'alert',json_object('kind','unassigned','title','Critical incident needs a team','body',title||' has remained unassigned for at least 30 minutes.','entity',id),? FROM incidents WHERE severity='critical' AND status!='resolved' AND team_id IS NULL AND created_at<=?",
    ).bind(time, incidentCutoff),
    env.DB.prepare(
      "INSERT OR IGNORE INTO outbox(id,kind,payload,created_at) SELECT 'overdue:'||r.id,'alert',json_object('kind','overdue','title','Relief request overdue','body',i.title||' has a pending request older than 60 minutes.','entity',i.id),? FROM requests r JOIN incidents i ON i.id=r.incident_id WHERE r.status='pending' AND r.created_at<=?",
    ).bind(time, requestCutoff),
    env.DB.prepare(
      "INSERT OR IGNORE INTO outbox(id,kind,payload,created_at) SELECT 'stock:'||id||':'||version,'alert',json_object('kind','low-stock','title','Supplies running low','body',name||': '||quantity||' '||unit||' remaining at '||location,'entity',NULL),? FROM resources WHERE quantity<=10",
    ).bind(time),
    env.DB.prepare(
      "INSERT INTO job_runs(id,last_run,details) VALUES('escalations',?,'Checks critical incidents after 30m, pending requests after 60m, and stock at 10 units or fewer.') ON CONFLICT(id) DO UPDATE SET last_run=excluded.last_run,details=excluded.details",
    ).bind(time),
  ]);
  // Reconcile interrupted uploads/deletions; a file remains unavailable until its database metadata is ready.
  if (env.FILES) {
    const stale = await env.DB.prepare(
      "SELECT id FROM attachments WHERE status!='ready' AND created_at<? LIMIT 20",
    )
      .bind(new Date(now.getTime() - 3600000).toISOString())
      .all<{ id: string }>();
    for (const a of stale.results) {
      await env.FILES.delete(a.id);
      await env.DB.prepare(
        "DELETE FROM attachments WHERE id=? AND status!='ready'",
      )
        .bind(a.id)
        .run();
    }
  }
  await flushOutbox(env);
  await broadcast(env);
  return results.slice(0, 3).reduce((n, r) => n + r.meta.changes, 0);
}
