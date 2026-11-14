"use client";
import { useEffect, useState, useRef } from "react";
export function useLive(
  enabled: boolean,
  cloud: boolean,
  onUpdate: () => void,
  room = "workspace",
) {
  const [live, setLive] = useState(false),
    [peers, setPeers] = useState<{ id: string; name: string }[]>([]);
  const callback = useRef(onUpdate);
  callback.current = onUpdate;
  useEffect(() => {
    if (!enabled) return;
    let stopped = false,
      socket: WebSocket | null = null,
      source: EventSource | null = null,
      retry: ReturnType<typeof setTimeout> | undefined,
      heartbeat: ReturnType<typeof setInterval> | undefined,
      delay = 1000;
    const close = () => {
      clearTimeout(retry);
      clearInterval(heartbeat);
      source?.close();
      source = null;
      if (socket) {
        socket.onclose = null;
        socket.close();
        socket = null;
      }
      setLive(false);
      setPeers([]);
    };
    const connect = () => {
      close();
      if (stopped || document.hidden) return;
      if (!cloud) {
        if (room !== "workspace") return;
        source = new EventSource("/api/events");
        source.onopen = () => setLive(true);
        source.onerror = () => setLive(false);
        source.addEventListener("update", () => callback.current());
        return;
      }
      const url = new URL("/api/live", location.href);
      url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
      url.searchParams.set("room", room);
      socket = new WebSocket(url);
      socket.onopen = () => {
        setLive(true);
        delay = 1000;
        heartbeat = setInterval(() => {
          if (socket?.readyState === WebSocket.OPEN) socket.send("ping");
        }, 25000);
      };
      socket.onmessage = (e) => {
        if (e.data === "pong") return;
        try {
          const d = JSON.parse(e.data);
          if (Array.isArray(d.peers)) setPeers(d.peers);
          if (d.type === "update") callback.current();
        } catch {}
      };
      socket.onerror = () => setLive(false);
      socket.onclose = () => {
        setLive(false);
        setPeers([]);
        clearInterval(heartbeat);
        if (!stopped && !document.hidden) {
          retry = setTimeout(connect, delay);
          delay = Math.min(delay * 2, 15000);
        }
      };
    };
    connect();
    const wake = () => connect();
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);
    return () => {
      stopped = true;
      close();
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake);
    };
  }, [enabled, cloud, room]);
  return { live, peers };
}
