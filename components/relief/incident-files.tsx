"use client";
import { useEffect, useState, useRef, useCallback } from "react";
import { Paperclip, Upload, Download, Trash2, Users } from "lucide-react";
import { useLive } from "@/hooks/use-live";
type Attachment = {
  id: string;
  name: string;
  size: number;
  created_by: string;
};
export function IncidentFiles({
  incident,
  user,
  cloud,
  revision,
}: {
  incident: string;
  user: { id: string; role: string };
  cloud: boolean;
  revision: string;
}) {
  const [files, setFiles] = useState<Attachment[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [remove, setRemove] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null),
    attempt = useRef<{ file: File; key: string } | null>(null);
  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/cloud/attachments?incident=${incident}`);
      const data: any = await r.json();
      if (!r.ok) throw new Error(data.error);
      setFiles(data);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [incident]);
  const { peers } = useLive(cloud, cloud, load, incident);
  useEffect(() => {
    if (cloud) void load();
  }, [cloud, load, revision]);
  async function upload() {
    const file = input.current?.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setError("Choose a file no larger than 5 MB.");
      return;
    }
    if (attempt.current?.file !== file)
      attempt.current = { file, key: crypto.randomUUID() };
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/cloud/attachments", {
        method: "POST",
        headers: {
          "Content-Type": file.type,
          "X-Filename": encodeURIComponent(file.name),
          "X-Incident-ID": incident,
          "Idempotency-Key": attempt.current!.key,
        },
        body: file,
      });
      const d: any = await r.json();
      if (!r.ok) throw new Error(d.error);
      attempt.current = null;
      if (input.current) input.current.value = "";
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function destroy(id: string) {
    setBusy(true);
    setError("");
    try {
      const r = await fetch(`/api/cloud/files/${id}`, { method: "DELETE" });
      const d: any = await r.json();
      if (!r.ok) throw new Error(d.error);
      setRemove(null);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="attachments">
      <div className="attachment-heading">
        <h3>
          <Paperclip size={16} /> Incident attachments
        </h3>
        <span title={peers.map((p) => p.name).join(", ")}>
          <Users size={14} /> {peers.length} viewing
        </span>
      </div>
      {!cloud ? (
        <p className="muted">
          Attachments are not available on this deployment.
        </p>
      ) : (
        <>
          {error && (
            <p role="alert" className="alert">
              {error}
            </p>
          )}
          <p className="muted">
            Photos, assessments, and delivery receipts. JPEG, PNG, or PDF; up to
            5 MB each.
          </p>
          <div className="upload-row">
            <input
              ref={input}
              aria-label="Choose incident attachment"
              type="file"
              accept="image/jpeg,image/png,application/pdf"
              disabled={busy}
            />
            <button
              className="secondary"
              type="button"
              disabled={busy}
              onClick={upload}
            >
              <Upload size={15} />
              {busy ? "Working…" : "Upload"}
            </button>
          </div>
          {files.map((f) => (
            <div className="attachment-row" key={f.id}>
              <div>
                <a href={`/api/cloud/files/${f.id}`}>
                  <Download size={14} />
                  {f.name}
                </a>
                <small>{Math.max(1, Math.round(f.size / 1024))} KB</small>
              </div>
              {(user.role === "coordinator" || f.created_by === user.id) &&
                (remove === f.id ? (
                  <div className="inline-actions">
                    <button
                      type="button"
                      disabled={busy}
                      className="text-button"
                      onClick={() => destroy(f.id)}
                    >
                      Confirm removal
                    </button>
                    <button
                      type="button"
                      className="icon"
                      onClick={() => setRemove(null)}
                    >
                      Keep
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="icon"
                    aria-label={`Remove ${f.name}`}
                    disabled={busy}
                    onClick={() => setRemove(f.id)}
                  >
                    <Trash2 size={15} />
                  </button>
                ))}
            </div>
          ))}
          {!files.length && <p className="muted">No attachments yet.</p>}
        </>
      )}
    </section>
  );
}
