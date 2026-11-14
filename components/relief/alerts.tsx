"use client";
import { useState } from "react";
import { Bell, Check, RefreshCw } from "lucide-react";
type Notice = {
  id: string;
  kind: string;
  title: string;
  body: string;
  created_at: string;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  entity_id: string | null;
};
export function Alerts({
  items,
  role,
  lastRun,
  onRefresh,
  onIncident,
}: {
  items: Notice[];
  role: string;
  lastRun?: string;
  onRefresh: () => void;
  onIncident: (id: string) => void;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [showAcknowledged, setShowAcknowledged] = useState(false);
  async function act(path: string) {
    setBusy(true);
    setError("");
    try {
      const r = await fetch(path, { method: "POST" });
      const d: any = await r.json();
      if (!r.ok) throw new Error(d.error);
      onRefresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const visible = items.filter((n) => showAcknowledged || !n.acknowledged_at);
  return (
    <section>
      <div className="toolbar">
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={showAcknowledged}
            onChange={(e) => setShowAcknowledged(e.target.checked)}
          />{" "}
          Show acknowledged
        </label>
        {role === "coordinator" && (
          <button
            className="secondary"
            disabled={busy}
            onClick={() => act("/api/cloud/scan")}
          >
            <RefreshCw size={15} />
            Check now
          </button>
        )}
      </div>
      <p className="muted">
        Checks run every 5 minutes.{" "}
        {lastRun
          ? `Last check: ${new Date(lastRun).toLocaleString()}`
          : "Waiting for the first scheduled check."}
      </p>
      <p className="panel-note">
        Escalates critical incidents unassigned for 30 minutes, requests pending
        for 60 minutes, and supplies at 10 units or fewer. Acknowledging an
        alert does not resolve the underlying incident.
      </p>
      {error && (
        <div className="alert" role="alert">
          {error}
        </div>
      )}
      <div className="panel">
        {visible.map((n) => (
          <article className="alert-card" key={n.id}>
            <Bell size={18} />
            <div>
              <h2>{n.title}</h2>
              <p>{n.body}</p>
              <small>
                {new Date(n.created_at).toLocaleString()}
                {n.acknowledged_by
                  ? ` · Acknowledged by ${n.acknowledged_by}`
                  : ""}
              </small>
              <div className="inline-actions">
                {n.entity_id && (
                  <button
                    className="text-button"
                    onClick={() => onIncident(n.entity_id!)}
                  >
                    View incident
                  </button>
                )}
                {!n.acknowledged_at && role !== "reporter" && (
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() =>
                      act(
                        `/api/cloud/acknowledge?id=${encodeURIComponent(n.id)}`,
                      )
                    }
                  >
                    <Check size={14} />
                    Acknowledge
                  </button>
                )}
              </div>
            </div>
          </article>
        ))}
        {!visible.length && (
          <div className="empty">
            <Bell />
            <h3>No outstanding alerts</h3>
            <p>
              Critical reports, dispatch confirmations, and scheduled
              escalations appear here.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
