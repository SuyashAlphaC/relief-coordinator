const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const json = (error: string, status: number) =>
  Response.json({ error }, { status });
const maxFile = 5 * 1024 * 1024;
export async function cloudGateway(
  request: Request,
  env: Cloudflare.Env,
): Promise<Response> {
  const db = env.DB,
    service = env.CLOUD,
    id = request.headers.get("oai-authenticated-user-id");
  if (!id) return json("Sign in first.", 401);
  if (!db || !service) return json("Cloud services are not configured.", 503);
  const member = await db
    .prepare("SELECT id,name,role FROM members WHERE id=?")
    .bind(id)
    .first<{ id: string; name: string; role: string }>();
  if (!member) return json("Open the dashboard before continuing.", 403);
  const url = new URL(request.url),
    path = url.pathname;
  if (request.method !== "GET" && request.headers.get("origin") !== url.origin)
    return json("Cross-origin writes are not allowed.", 403);
  if (path === "/api/live") {
    if (request.headers.get("origin") !== url.origin)
      return json("Cross-origin connections are not allowed.", 403);
    const room = url.searchParams.get("room") || "workspace";
    if (
      room !== "workspace" &&
      (!uuid.test(room) ||
        !(await db
          .prepare("SELECT id FROM incidents WHERE id=?")
          .bind(room)
          .first()))
    )
      return json("Incident room not found.", 404);
    const headers = new Headers({
      Upgrade: "websocket",
      "x-member-id": member.id,
      "x-member-name": encodeURIComponent(member.name),
    });
    return service.fetch(
      `https://cloud/live?room=${encodeURIComponent(room)}`,
      { headers },
    );
  }
  if (path === "/api/cloud/scan" && request.method === "POST") {
    if (member.role !== "coordinator")
      return json("Coordinator access required.", 403);
    return service.fetch("https://cloud/scan", { method: "POST" });
  }
  if (path === "/api/cloud/acknowledge" && request.method === "POST") {
    if (member.role === "reporter")
      return json("Responder access required.", 403);
    const notification = url.searchParams.get("id");
    if (!notification || notification.length > 150)
      return json("Invalid notification.", 400);
    const result = await db
      .prepare(
        "UPDATE notifications SET acknowledged_by=?,acknowledged_at=? WHERE id=? AND acknowledged_at IS NULL",
      )
      .bind(member.name, new Date().toISOString(), notification)
      .run();
    return result.meta.changes
      ? Response.json({ ok: true })
      : json("Notification was already acknowledged or no longer exists.", 409);
  }
  if (path === "/api/cloud/attachments" && request.method === "GET") {
    const incident = url.searchParams.get("incident");
    if (!incident || !uuid.test(incident))
      return json("Invalid incident.", 400);
    return Response.json(
      (
        await db
          .prepare(
            "SELECT id,name,content_type,size,created_by,created_at FROM attachments WHERE incident_id=? AND status='ready' ORDER BY created_at DESC",
          )
          .bind(incident)
          .all()
      ).results,
      { headers: { "Cache-Control": "no-store" } },
    );
  }
  if (path === "/api/cloud/attachments" && request.method === "POST") {
    const incident = request.headers.get("x-incident-id"),
      fileId = request.headers.get("idempotency-key");
    let name = "";
    try {
      name = decodeURIComponent(request.headers.get("x-filename") || "").trim();
    } catch {
      return json("Invalid filename.", 400);
    }
    if (
      !incident ||
      !uuid.test(incident) ||
      !fileId ||
      !uuid.test(fileId) ||
      !name ||
      name.length > 150 ||
      /[\u0000-\u001f\u007f]/.test(name)
    )
      return json("Invalid file details.", 400);
    if (
      !(await db
        .prepare("SELECT id FROM incidents WHERE id=?")
        .bind(incident)
        .first())
    )
      return json("Incident not found.", 404);
    const old = await db
      .prepare(
        "SELECT created_by,incident_id,status FROM attachments WHERE id=?",
      )
      .bind(fileId)
      .first<{ created_by: string; incident_id: string; status: string }>();
    if (old)
      return old.created_by === id &&
        old.incident_id === incident &&
        old.status === "ready"
        ? Response.json({ ok: true, id: fileId })
        : json("Upload already in progress or retry key is unavailable.", 409);
    const type = request.headers.get("content-type")?.split(";")[0];
    if (!["image/jpeg", "image/png", "application/pdf"].includes(type || ""))
      return json("Upload a JPEG, PNG, or PDF.", 415);
    if (Number(request.headers.get("content-length")) > maxFile)
      return json("Files must be 5 MB or smaller.", 413);
    const reader = request.body?.getReader();
    if (!reader) return json("Choose a file.", 400);
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > maxFile) {
        await reader.cancel();
        return json("Files must be 5 MB or smaller.", 413);
      }
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    const valid =
      type === "application/pdf"
        ? new TextDecoder().decode(bytes.slice(0, 5)) === "%PDF-"
        : type === "image/png"
          ? [137, 80, 78, 71, 13, 10, 26, 10].every((n, i) => bytes[i] === n)
          : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    if (!valid)
      return json("File contents do not match the selected file type.", 400);
    try {
      await db
        .prepare(
          "INSERT INTO attachments(id,incident_id,name,content_type,size,created_by,created_at) VALUES(?,?,?,?,?,?,?)",
        )
        .bind(fileId, incident, name, type!, size, id, new Date().toISOString())
        .run();
    } catch (e) {
      if (String(e).includes("ATTACHMENT_LIMIT"))
        return json(
          "Attachment limit reached: 20 files per incident or 500 MB total.",
          409,
        );
      throw e;
    }
    try {
      const uploaded = await service.fetch(`https://cloud/files/${fileId}`, {
        method: "PUT",
        headers: { "Content-Type": type! },
        body: bytes,
      });
      if (!uploaded.ok)
        return json("Upload could not finish. Please retry later.", 503);
      await db.batch([
        db
          .prepare("UPDATE attachments SET status='ready' WHERE id=?")
          .bind(fileId),
        db
          .prepare(
            "INSERT INTO activity(id,actor,message,created_at) VALUES(?,?,?,?)",
          )
          .bind(
            crypto.randomUUID(),
            member.name,
            `Attached ${name}`,
            new Date().toISOString(),
          ),
      ]);
      return Response.json({ ok: true, id: fileId });
    } catch {
      return json("Upload could not finish. Please retry later.", 503);
    }
  }
  const fileId = path.startsWith("/api/cloud/files/")
    ? path.slice("/api/cloud/files/".length)
    : "";
  if (uuid.test(fileId)) {
    const file = await db
      .prepare("SELECT * FROM attachments WHERE id=?")
      .bind(fileId)
      .first<{ name: string; status: string; created_by: string }>();
    if (!file || file.status !== "ready")
      return json("Attachment not found.", 404);
    if (request.method === "GET") {
      const response = await service.fetch(`https://cloud/files/${fileId}`);
      if (!response.ok)
        return json("Attachment is unavailable.", response.status);
      const headers = new Headers(response.headers);
      headers.set(
        "Content-Disposition",
        `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      );
      headers.set("X-Content-Type-Options", "nosniff");
      headers.set("Cache-Control", "private, no-store");
      headers.set("Content-Security-Policy", "default-src 'none'; sandbox");
      return new Response(response.body, { headers });
    }
    if (request.method === "DELETE") {
      if (member.role !== "coordinator" && file.created_by !== id)
        return json(
          "Only the uploader or a coordinator can remove this file.",
          403,
        );
      const changed = await db
        .prepare(
          "UPDATE attachments SET status='deleting' WHERE id=? AND status='ready'",
        )
        .bind(fileId)
        .run();
      if (!changed.meta.changes)
        return json("Attachment changed. Refresh and retry.", 409);
      const deleted = await service.fetch(`https://cloud/files/${fileId}`, {
        method: "DELETE",
      });
      if (!deleted.ok) return json("Deletion is pending cleanup.", 503);
      await db.batch([
        db.prepare("DELETE FROM attachments WHERE id=?").bind(fileId),
        db
          .prepare(
            "INSERT INTO activity(id,actor,message,created_at) VALUES(?,?,?,?)",
          )
          .bind(
            crypto.randomUUID(),
            member.name,
            `Removed attachment ${file.name}`,
            new Date().toISOString(),
          ),
      ]);
      return Response.json({ ok: true });
    }
  }
  return json("Not found.", 404);
}
