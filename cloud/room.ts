import { DurableObject } from "cloudflare:workers";
import type { CloudEnv } from "./types";
type Peer = { id: string; name: string; expires: number };
export class CoordinationRoom extends DurableObject<CloudEnv> {
  constructor(ctx: DurableObjectState, env: CloudEnv) {
    super(ctx, env);
    this.ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair("ping", "pong"),
    );
  }
  peers() {
    const peers = new Map<string, string>();
    for (const s of this.ctx.getWebSockets()) {
      const p = s.deserializeAttachment() as Peer;
      if (p.expires > Date.now() && s.readyState === WebSocket.OPEN)
        peers.set(p.id, p.name);
    }
    return [...peers].map(([id, name]) => ({ id, name }));
  }
  send(type: string) {
    const text = JSON.stringify({ type, peers: this.peers() });
    for (const s of this.ctx.getWebSockets()) {
      try {
        s.send(text);
      } catch {
        try {
          s.close(1011, "Reconnect");
        } catch {}
      }
    }
  }
  async fetch(request: Request) {
    if (
      new URL(request.url).pathname === "/broadcast" &&
      request.method === "POST"
    ) {
      this.send("update");
      return new Response("ok");
    }
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket")
      return new Response("WebSocket required", { status: 426 });
    const id = request.headers.get("x-member-id"),
      name = request.headers.get("x-member-name");
    if (!id || !name) return new Response("Unauthorized", { status: 401 });
    if (this.ctx.getWebSockets().length >= 100)
      return new Response("Room is full. Try again shortly.", { status: 503 });
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({
      id,
      name: decodeURIComponent(name),
      expires: Date.now() + 300000,
    } satisfies Peer);
    if (!(await this.ctx.storage.getAlarm()))
      await this.ctx.storage.setAlarm(Date.now() + 60000);
    this.send("presence");
    server.send(JSON.stringify({ type: "update", peers: this.peers() }));
    return new Response(null, { status: 101, webSocket: client });
  }
  webSocketMessage(socket: WebSocket) {
    socket.close(1008, "Only heartbeat messages are supported");
  }
  webSocketClose(socket: WebSocket, code: number) {
    socket.close(
      code === 1000 || (code >= 3000 && code <= 4999) ? code : 1000,
      "Disconnected",
    );
    this.send("presence");
  }
  webSocketError(socket: WebSocket) {
    socket.close(1011, "Reconnect");
    this.send("presence");
  }
  async alarm() {
    for (const s of this.ctx.getWebSockets()) {
      const p = s.deserializeAttachment() as Peer;
      if (p.expires <= Date.now()) s.close(1000, "Refresh sign-in");
    }
    this.send("presence");
    if (this.ctx.getWebSockets().length)
      await this.ctx.storage.setAlarm(Date.now() + 60000);
  }
}
