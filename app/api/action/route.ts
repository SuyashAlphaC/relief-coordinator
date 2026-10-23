import { receiptIdentity, priorReceipt } from "@/lib/idempotency";
import { database, identity, failure, ApiError, audit } from "@/lib/server";
import { actionInput, transitions } from "@/lib/validation";
export async function POST(request: Request) {
  try {
    const origin = request.headers.get("origin");
    if (!origin || origin !== new URL(request.url).origin)
      throw new ApiError(403, "Cross-origin writes are not allowed.");
    if (!request.headers.get("content-type")?.startsWith("application/json"))
      throw new ApiError(415, "Send JSON.");
    const body = await request.text();
    if (body.length > 12000) throw new ApiError(413, "Request is too large.");
    let input;
    try {
      input = JSON.parse(body);
    } catch {
      throw new ApiError(400, "Invalid JSON.");
    }
    const parsed = actionInput.safeParse(input);
    if (!parsed.success)
      throw new ApiError(
        400,
        parsed.error.issues.map((i) => i.message).join("; "),
      );
    const a = parsed.data,
      u = await identity(),
      db = database(),
      id = crypto.randomUUID(),
      now = new Date().toISOString();
    const receipt = await receiptIdentity(request, u.id, JSON.stringify(a));
    const replay = await priorReceipt(receipt);
    if (replay) return replay;
    if (!["incident", "request"].includes(a.action) && u.role === "reporter")
      throw new ApiError(403, "Responder access required.");
    if (
      ["team", "resource", "restock", "role"].includes(a.action) &&
      u.role !== "coordinator"
    )
      throw new ApiError(403, "Coordinator access required.");
    let stmt: D1PreparedStatement,
      message = "";
    switch (a.action) {
      case "incident": {
        const d = a.data;
        stmt = db
          .prepare(
            "INSERT INTO incidents (id,title,type,severity,location,lat,lng,description,people,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
          )
          .bind(
            id,
            d.title,
            d.type,
            d.severity,
            d.location,
            d.lat,
            d.lng,
            d.description,
            d.people,
            u.id,
            now,
          );
        message = `Reported ${d.title}`;
        break;
      }
      case "team":
        stmt = db
          .prepare(
            "INSERT INTO teams (id,name,specialty,personnel,location) VALUES (?,?,?,?,?)",
          )
          .bind(id, a.name, a.specialty, a.personnel, a.location);
        message = `Added team ${a.name}`;
        break;
      case "resource":
        stmt = db
          .prepare(
            "INSERT INTO resources (id,name,unit,quantity,location) VALUES (?,?,?,?,?)",
          )
          .bind(id, a.name, a.unit, a.quantity, a.location);
        message = `Added supply ${a.name}`;
        break;
      case "restock":
        stmt = db
          .prepare(
            "UPDATE resources SET quantity=quantity+?,version=version+1 WHERE id=? AND version=? AND quantity+?<=1000000",
          )
          .bind(a.quantity, a.id, a.version, a.quantity);
        message = `Restocked ${a.quantity} units`;
        break;
      case "status": {
        const old = await db
          .prepare("SELECT * FROM incidents WHERE id=?")
          .bind(a.id)
          .first<{ status: string; title: string }>();
        if (!old) throw new ApiError(404, "Incident not found.");
        if (
          old.status !== a.status &&
          !transitions[old.status]?.includes(a.status)
        )
          throw new ApiError(
            409,
            "This incident status transition is not allowed.",
          );
        if (a.status === "responding" && !a.teamId)
          throw new ApiError(400, "Assign a team before starting a response.");
        if (
          a.teamId &&
          !(await db
            .prepare("SELECT id FROM teams WHERE id=?")
            .bind(a.teamId)
            .first())
        )
          throw new ApiError(400, "Team not found.");
        stmt = db
          .prepare(
            "UPDATE incidents SET status=?,team_id=?,version=version+1 WHERE id=? AND version=?",
          )
          .bind(a.status, a.teamId, a.id, a.version);
        message = `${old.title}: ${a.status}`;
        break;
      }
      case "request": {
        if (
          !(await db
            .prepare(
              "SELECT id FROM incidents WHERE id=? AND status!='resolved'",
            )
            .bind(a.incidentId)
            .first())
        )
          throw new ApiError(400, "Select an active incident.");
        if (
          !(await db
            .prepare("SELECT id FROM resources WHERE id=?")
            .bind(a.resourceId)
            .first())
        )
          throw new ApiError(400, "Resource not found.");
        stmt = db
          .prepare(
            "INSERT INTO requests (id,incident_id,resource_id,quantity,created_by,created_at) VALUES (?,?,?,?,?,?)",
          )
          .bind(id, a.incidentId, a.resourceId, a.quantity, u.id, now);
        message = `Requested ${a.quantity} relief units`;
        break;
      }
      case "fulfill":
      case "cancel":
        stmt = db
          .prepare(
            "UPDATE requests SET status=?,version=version+1 WHERE id=? AND version=? AND status='pending'",
          )
          .bind(
            a.action === "fulfill" ? "fulfilled" : "cancelled",
            a.id,
            a.version,
          );
        message =
          a.action === "fulfill"
            ? "Dispatched relief supplies"
            : "Cancelled relief request";
        break;
      case "role": {
        if (a.id === u.id)
          throw new ApiError(400, "You cannot change your own role.");
        stmt = db
          .prepare("UPDATE members SET role=? WHERE id=?")
          .bind(a.role, a.id);
        message = `Changed member role to ${a.role}`;
        break;
      }
    }
    // Trigger checks enforce stock and resource allocation within the same transaction.
    let result;
    try {
      result = await db.batch([
        stmt,
        db
          .prepare(
            "INSERT INTO activity (id,actor,message,created_at) SELECT ?,?,?,? WHERE changes()>0",
          )
          .bind(id, u.name, message, now),
        ...(receipt
          ? [
              db
                .prepare(
                  "INSERT INTO receipts (id,actor,body_hash,result_id,created_at) SELECT ?,?,?,?,? WHERE changes()>0",
                )
                .bind(receipt.id, u.id, receipt.hash, id, now),
            ]
          : []),
      ]);
    } catch (e) {
      const replay = await priorReceipt(receipt);
      if (replay) return replay;
      throw e;
    }
    if (!result[0].meta.changes)
      throw new ApiError(
        409,
        "This record changed or no longer exists. Refresh and try again.",
      );
    return Response.json({ ok: true, id });
  } catch (e) {
    if (e instanceof Error && e.message.includes("LAST_COORDINATOR"))
      return Response.json(
        { error: "At least one coordinator must remain." },
        { status: 409 },
      );
    if (e instanceof Error && e.message.includes("INCIDENT_RESOLVED"))
      return Response.json(
        { error: "This incident is resolved. Select an active incident." },
        { status: 409 },
      );
    if (e instanceof Error && e.message.includes("PENDING_REQUESTS"))
      return Response.json(
        {
          error:
            "Dispatch or cancel pending relief requests before resolving this incident.",
        },
        { status: 409 },
      );
    if (e instanceof Error && e.message.includes("INSUFFICIENT_STOCK"))
      return Response.json(
        { error: "Insufficient stock. Restock before dispatching." },
        { status: 409 },
      );
    return failure(e);
  }
}
