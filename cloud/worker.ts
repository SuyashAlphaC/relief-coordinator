import { assignWaitingIncidents } from "../lib/auto-assignment";
import type { CloudEnv } from "./types";
import { broadcast, flushOutbox, consumeEvent, scanEscalations } from "./jobs";
export { CoordinationRoom } from "./room";
export default {
  async fetch(
    request: Request,
    env: CloudEnv,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);
    // This Worker has no public routes: only the application's service binding may call it.
    if (url.pathname === "/pulse" && request.method === "POST") {
      ctx.waitUntil(
        assignWaitingIncidents(env.DB)
          .then(() => flushOutbox(env))
          .then(() => broadcast(env))
          .catch((e) =>
            console.error("Outbox deferred to scheduled retry", String(e)),
          ),
      );
      await broadcast(env);
      const room = url.searchParams.get("room");
      if (room && /^[0-9a-f-]{36}$/.test(room)) await broadcast(env, room);
      return Response.json({ ok: true });
    }
    if (url.pathname === "/scan" && request.method === "POST") {
      await assignWaitingIncidents(env.DB);
      const alerts = await scanEscalations(env);
      return Response.json({ alerts });
    }
    if (url.pathname === "/live") {
      const room = url.searchParams.get("room") || "workspace";
      if (room !== "workspace" && !/^[0-9a-f-]{36}$/.test(room))
        return new Response("Invalid room", { status: 400 });
      return env.ROOMS.get(env.ROOMS.idFromName(room)).fetch(request);
    }
    if (url.pathname.startsWith("/files/")) {
      if (!env.FILES)
        return Response.json(
          { error: "File storage has not been enabled." },
          { status: 503 },
        );
      const id = url.pathname.slice(7);
      if (!/^[0-9a-f-]{36}$/.test(id))
        return new Response("Invalid file ID", { status: 400 });
      if (request.method === "PUT") {
        await env.FILES.put(id, request.body, {
          httpMetadata: {
            contentType:
              request.headers.get("Content-Type") || "application/octet-stream",
          },
        });
        return Response.json({ ok: true });
      }
      if (request.method === "DELETE") {
        await env.FILES.delete(id);
        return Response.json({ ok: true });
      }
      if (request.method === "GET") {
        const file = await env.FILES.get(id);
        if (!file) return new Response("File missing", { status: 404 });
        return new Response(file.body, {
          headers: {
            "Content-Type":
              file.httpMetadata?.contentType || "application/octet-stream",
          },
        });
      }
    }
    return new Response("Not found", { status: 404 });
  },
  async queue(batch: MessageBatch<{ id: string }>, env: CloudEnv) {
    for (const message of batch.messages) {
      try {
        if (!message.body?.id) throw new Error("Invalid event");
        await consumeEvent(env, message.body.id);
        message.ack();
      } catch (e) {
        console.error("Queue processing failed", String(e));
        message.retry({ delaySeconds: 30 });
      }
    }
  },
  async scheduled(
    _event: ScheduledController,
    env: CloudEnv,
    ctx: ExecutionContext,
  ) {
    ctx.waitUntil(
      (async () => {
        await assignWaitingIncidents(env.DB);
        if (new Date(_event.scheduledTime).getUTCMinutes() % 5 === 0)
          await scanEscalations(env);
        else {
          await flushOutbox(env);
          await broadcast(env);
        }
      })(),
    );
  },
};
