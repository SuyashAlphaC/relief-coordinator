import { database, identity, failure } from "@/lib/server";
export async function GET(request: Request) {
  try {
    await identity();
    const db = database(),
      encoder = new TextEncoder();
    let cancelled = false;
    let stop: () => void = () => {};
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        let closed = false;
        let previous = -1;
        const deadline = Date.now() + 25000;
        stop = () => {
          if (closed) return;
          closed = true;
          cancelled = true;
          if (timer) clearTimeout(timer);
          try {
            controller.close();
          } catch {}
          request.signal.removeEventListener("abort", stop);
        };
        request.signal.addEventListener("abort", stop, { once: true });
        const tick = async () => {
          if (cancelled) return;
          try {
            const row = await db
              .prepare("SELECT COALESCE(MAX(rowid),0) AS version FROM activity")
              .first<{ version: number }>();
            if (cancelled) return;
            const version = row?.version || 0;
            if (version !== previous) {
              controller.enqueue(
                encoder.encode(`event: update\ndata: ${version}\n\n`),
              );
              previous = version;
            } else controller.enqueue(encoder.encode(": heartbeat\n\n"));
            if (Date.now() >= deadline) stop();
            else timer = setTimeout(tick, 1000);
          } catch {
            stop();
          }
        };
        controller.enqueue(encoder.encode("retry: 1500\n\n"));
        void tick();
      },
      cancel() {
        cancelled = true;
        stop();
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (e) {
    return failure(e);
  }
}
