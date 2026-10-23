"use client";
import {
  useState,
  useEffect,
  useCallback,
  useRef,
  type FormEvent,
} from "react";
import {
  Activity,
  ArrowUpRight,
  Boxes,
  ChevronRight,
  ClipboardList,
  Download,
  MapPin,
  Plus,
  Radio,
  Search,
  Shield,
  Users,
  X,
  Check,
  TriangleAlert,
} from "lucide-react";
type Row = Record<string, any>;
type State = {
  user: Row;
  incidents: Row[];
  resources: Row[];
  teams: Row[];
  requests: Row[];
  activity: Row[];
  members: Row[];
};
const tabs = [
  ["Overview", Activity],
  ["Incidents", Radio],
  ["Relief requests", ClipboardList],
  ["Resources", Boxes],
  ["Response teams", Users],
  ["Access", Shield],
] as const;
const label = (s: string) =>
  s.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());
function Badge({ value }: { value: string }) {
  return <span className={`badge ${value}`}>{label(value)}</span>;
}
function Field({ name, children, ...props }: any) {
  return (
    <label className="field">
      <span>{children || label(name)}</span>
      <input name={name} required {...props} />
    </label>
  );
}
export default function Home() {
  const [state, setState] = useState<State | null>(null),
    [tab, setTab] = useState("Overview"),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all"),
    [modal, setModal] = useState<string | null>(null),
    [selected, setSelected] = useState<Row | null>(null),
    [error, setError] = useState(""),
    [syncError, setSyncError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [online, setOnline] = useState(false),
    [live, setLive] = useState(false),
    [lastSync, setLastSync] = useState("");
  const dialog = useRef<HTMLDialogElement>(null),
    fetching = useRef(false),
    attempt = useRef<{ body: string; key: string } | null>(null);
  const refresh = useCallback(async () => {
    if (fetching.current) return;
    fetching.current = true;
    try {
      const r = await fetch("/api/state", {
        cache: "no-store",
        signal: AbortSignal.timeout(10000),
      });
      const d: any = await r.json();
      if (!r.ok) throw new Error(d.error);
      setState(d);
      setOnline(true);
      setSyncError("");
      setLastSync(
        new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
      );
    } catch (e) {
      setOnline(false);
      setSyncError((e as Error).message);
    } finally {
      fetching.current = false;
    }
  }, []);
  useEffect(() => {
    refresh();
    const timer = setInterval(() => {
      if (!document.hidden) refresh();
    }, 30000);
    const wake = () => {
      if (!document.hidden) refresh();
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake);
    };
  }, [refresh]);
  useEffect(() => {
    if (!state) return;
    let source: EventSource | null = null;
    const connect = () => {
      source?.close();
      setLive(false);
      if (document.hidden) return;
      source = new EventSource("/api/events");
      source.onopen = () => setLive(true);
      source.onerror = () => setLive(false);
      source.addEventListener("update", () => refresh());
    };
    connect();
    document.addEventListener("visibilitychange", connect);
    return () => {
      source?.close();
      document.removeEventListener("visibilitychange", connect);
    };
  }, [!!state, refresh]);
  useEffect(() => {
    if (modal) dialog.current?.showModal();
    else dialog.current?.close();
  }, [modal]);
  const open = (kind: string, row: Row | null = null) => {
    setSelected(row);
    setError("");
    attempt.current = null;
    setModal(kind);
  };
  async function mutate(payload: Row) {
    const body = JSON.stringify(payload);
    if (attempt.current?.body !== body)
      attempt.current = { body, key: crypto.randomUUID() };
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/action", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": attempt.current!.key,
        },
        body,
      });
      const d: any = await r.json();
      if (!r.ok) throw new Error(d.error);
      attempt.current = null;
      setModal(null);
      setNotice("Saved to the coordination desk.");
      await refresh();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.currentTarget));
    let a: Row = { action: modal, ...data };
    if (modal === "incident")
      a = {
        action: modal,
        data: {
          ...data,
          people: Number(data.people),
          lat: data.lat === "" ? null : Number(data.lat),
          lng: data.lng === "" ? null : Number(data.lng),
        },
      };
    if (["resource", "restock", "request"].includes(modal || ""))
      a.quantity = Number(data.quantity);
    if (modal === "team") a.personnel = Number(data.personnel);
    if (selected) a = { ...a, id: selected.id, version: selected.version };
    if (modal === "status") a.teamId = data.teamId || null;
    await mutate(a);
  }
  const incidents = state?.incidents || [],
    active = incidents.filter((i) => i.status !== "resolved"),
    critical = active.filter((i) => i.severity === "critical"),
    pending = state?.requests.filter((r) => r.status === "pending") || [],
    role = state?.user.role,
    canRespond = role === "coordinator" || role === "responder",
    canManage = role === "coordinator";
  const matching = (rows: Row[]) =>
    rows.filter((r) =>
      JSON.stringify(r).toLowerCase().includes(query.toLowerCase()),
    );
  const sorted = [...matching(incidents)]
    .filter((i) => filter === "all" || i.severity === filter)
    .sort(
      (a, b) =>
        ["critical", "high", "medium", "low"].indexOf(a.severity) -
          ["critical", "high", "medium", "low"].indexOf(b.severity) ||
        b.created_at.localeCompare(a.created_at),
    );
  function incidentTable(rows: Row[]) {
    return (
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Incident / location</th>
              <th>Priority</th>
              <th>Status</th>
              <th>People affected</th>
              <th>Response team</th>
              <th>
                <span className="sr-only">Details</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((i) => (
              <tr key={i.id}>
                <td>
                  <button
                    className="row-title"
                    onClick={() => open("detail", i)}
                  >
                    {i.title}
                  </button>
                  <small>
                    <MapPin size={12} />
                    {i.location} · {i.type}
                  </small>
                </td>
                <td>
                  <Badge value={i.severity} />
                </td>
                <td>
                  <Badge value={i.status} />
                </td>
                <td className="number">{i.people.toLocaleString()}</td>
                <td>
                  {state?.teams.find((t) => t.id === i.team_id)?.name || (
                    <span className="muted">Unassigned</span>
                  )}
                </td>
                <td>
                  <button
                    className="icon"
                    aria-label={`View ${i.title}`}
                    onClick={() => open("detail", i)}
                  >
                    <ArrowUpRight size={18} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && (
          <div className="empty">
            <Radio />
            <h3>No incidents here</h3>
            <p>
              {query || filter !== "all"
                ? "Try changing your search or priority filter."
                : "Report an incident to start coordinating a response."}
            </p>
          </div>
        )}
      </div>
    );
  }
  function exportData() {
    const blob = new Blob([JSON.stringify(state, null, 2)], {
        type: "application/json",
      }),
      url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = `relief-desk-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <>
      <a href="#main" className="skip">
        Skip to content
      </a>
      <aside className="sidebar">
        <a href="/" className="brand">
          <span className="brand-icon">
            <Plus size={25} strokeWidth={3} />
          </span>
          <span>
            relief<span className="brand-light">desk</span>
            <small>EMERGENCY COORDINATION</small>
          </span>
        </a>
        <div className="workspace">
          <span className="workspace-icon">RD</span>
          <div>
            Operations workspace<small>Course project</small>
          </div>
        </div>
        <div className="nav-label">COORDINATION</div>
        <nav>
          {tabs
            .filter(([name]) => name !== "Access" || canManage)
            .map(([name, Icon]) => (
              <button
                key={name}
                className={tab === name ? "nav-item active" : "nav-item"}
                onClick={() => {
                  setTab(name);
                  setQuery("");
                  setFilter("all");
                }}
              >
                <Icon size={18} />
                {name}
                {name === "Relief requests" && pending.length > 0 && (
                  <span className="nav-count">{pending.length}</span>
                )}
              </button>
            ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="simulation">
            <Shield size={17} />
            <div>
              Learning environment
              <small>Not connected to emergency services.</small>
            </div>
          </div>
          <div className="profile">
            <span className="avatar">
              {state?.user.name?.slice(0, 2).toUpperCase() || "—"}
            </span>
            <div>
              {state?.user.name || "Sign-in required"}
              <small>{role ? label(role) : "Secure workspace"}</small>
            </div>
          </div>
        </div>
      </aside>
      <div className="shell">
        <header className="topbar">
          <div>
            Workspace <ChevronRight size={14} />
            <strong>{tab}</strong>
          </div>
          <div className="connection">
            <span className={online ? "dot" : "dot offline"} />
            {online
              ? `${live ? "Live updates" : "Reconnecting"} · ${lastSync}`
              : "Connection unavailable"}
          </div>
        </header>
        <main id="main">
          <div className="page-heading">
            <div>
              <div className="eyebrow">RELIEF DESK / OPERATIONS</div>
              <h1>
                {tab === "Overview" ? "Every response starts here." : tab}
              </h1>
              <p>
                {tab === "Overview"
                  ? "A shared picture of incidents, people, and the resources that connect them."
                  : {
                      Incidents:
                        "Triage reports, assign responders, and track the path to resolution.",
                      "Relief requests":
                        "Turn urgent needs into coordinated supply dispatches.",
                      Resources:
                        "Track available stock across your relief network.",
                      "Response teams":
                        "Know who is ready and where they are needed.",
                      Access:
                        "Manage responsibilities within your coordination workspace.",
                    }[tab]}
              </p>
            </div>
            <div className="heading-actions">
              <button
                className="secondary"
                onClick={exportData}
                disabled={!state}
              >
                <Download size={16} /> Export
              </button>
              <button
                className="primary"
                disabled={!state}
                onClick={() => open("incident")}
              >
                <Plus size={17} /> Report incident
              </button>
            </div>
          </div>
          {(error || syncError) && !modal && (
            <div role="alert" className="alert">
              <TriangleAlert size={18} />
              {error || syncError}
              <button
                onClick={() => {
                  setError("");
                  refresh();
                }}
              >
                Retry
              </button>
              {!state && (
                <a href="/signin-with-chatgpt?return_to=%2F" target="_top">
                  Sign in
                </a>
              )}
            </div>
          )}
          {notice && (
            <div className="notice" role="status">
              <Check size={17} />
              {notice}
              <button
                aria-label="Dismiss notification"
                onClick={() => setNotice("")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {!state ? (
            <section className="panel empty">
              <Radio />
              <h2>Connecting to your coordination desk</h2>
              <p>Secure incident and relief data will appear here.</p>
            </section>
          ) : (
            <>
              {tab === "Overview" && (
                <>
                  <section className="metrics">
                    {[
                      [
                        "Active incidents",
                        active.length,
                        `${critical.length} critical priority`,
                      ],
                      [
                        "People affected",
                        active.reduce((sum, i) => sum + i.people, 0),
                        "Across active reports",
                      ],
                      [
                        "Pending requests",
                        pending.length,
                        "Awaiting relief dispatch",
                      ],
                      [
                        "Response teams",
                        state.teams.length,
                        `${state.teams.reduce((sum, t) => sum + t.personnel, 0)} personnel registered`,
                      ],
                    ].map(([title, value, sub], i) => (
                      <div className="metric" key={title}>
                        <div>
                          {title}
                          <span className={`metric-symbol s${i}`}>
                            {
                              [
                                <Radio key="r" />,
                                <Users key="u" />,
                                <Boxes key="b" />,
                                <Shield key="s" />,
                              ][i]
                            }
                          </span>
                        </div>
                        <strong>{value.toLocaleString()}</strong>
                        <small>{sub}</small>
                      </div>
                    ))}
                  </section>
                  <div className="overview-grid">
                    <section className="panel">
                      <div className="panel-heading">
                        <div>
                          <h2>Response priorities</h2>
                          <p>Active reports, ordered by urgency</p>
                        </div>
                        <button
                          className="text-button"
                          onClick={() => setTab("Incidents")}
                        >
                          All incidents <ArrowUpRight size={15} />
                        </button>
                      </div>
                      {incidentTable(
                        sorted
                          .filter((i) => i.status !== "resolved")
                          .slice(0, 6),
                      )}
                    </section>
                    <section className="panel activity">
                      <div className="panel-heading">
                        <div>
                          <h2>Field log</h2>
                          <p>The latest coordination updates</p>
                        </div>
                        <span className="live-label">
                          {live ? "LIVE" : "SYNCING"}
                        </span>
                      </div>
                      <div className="timeline">
                        {state.activity.slice(0, 8).map((a) => (
                          <div className="event" key={a.id}>
                            <span className="event-dot" />
                            <div>
                              <p>{a.message}</p>
                              <small>
                                {a.actor} ·{" "}
                                {new Date(a.created_at).toLocaleTimeString([], {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              </small>
                            </div>
                          </div>
                        ))}
                        {!state.activity.length && (
                          <p className="muted">
                            Updates will appear as your team works.
                          </p>
                        )}
                      </div>
                    </section>
                  </div>
                  <section className="next-step">
                    <div className="next-icon">
                      <Boxes size={26} />
                    </div>
                    <div>
                      <h2>Keep relief moving.</h2>
                      <p>
                        {pending.length
                          ? `${pending.length} requests are waiting for supplies. Review stock and coordinate dispatch.`
                          : "Register supplies and response teams to prepare for the next report."}
                      </p>
                    </div>
                    <button
                      className="secondary"
                      onClick={() =>
                        setTab(pending.length ? "Relief requests" : "Resources")
                      }
                    >
                      View {pending.length ? "requests" : "resources"}{" "}
                      <ArrowUpRight size={16} />
                    </button>
                  </section>
                </>
              )}
              {tab !== "Overview" && tab !== "Access" && (
                <div className="toolbar">
                  <label className="search">
                    <Search size={17} />
                    <input
                      aria-label={`Search ${tab}`}
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder={`Search ${tab.toLowerCase()}…`}
                    />
                  </label>
                  {tab === "Incidents" && (
                    <select
                      aria-label="Filter by priority"
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                    >
                      {["all", "critical", "high", "medium", "low"].map((v) => (
                        <option value={v} key={v}>
                          {v === "all" ? "All priorities" : label(v)}
                        </option>
                      ))}
                    </select>
                  )}
                  {tab === "Resources" && canManage && (
                    <button
                      className="primary"
                      onClick={() => open("resource")}
                    >
                      <Plus size={16} />
                      Add resource
                    </button>
                  )}
                  {tab === "Response teams" && canManage && (
                    <button className="primary" onClick={() => open("team")}>
                      <Plus size={16} />
                      Add team
                    </button>
                  )}
                  {tab === "Relief requests" && (
                    <button className="primary" onClick={() => open("request")}>
                      <Plus size={16} />
                      Request relief
                    </button>
                  )}
                </div>
              )}
              {tab === "Incidents" && (
                <section className="panel">{incidentTable(sorted)}</section>
              )}
              {tab === "Resources" && (
                <section className="card-grid">
                  {matching(state.resources).map((r) => (
                    <article className="resource-card" key={r.id}>
                      <div className="resource-heading">
                        <Boxes size={22} />
                        <Badge value={r.quantity ? "available" : "depleted"} />
                      </div>
                      <h2>{r.name}</h2>
                      <p>
                        <MapPin size={14} />
                        {r.location}
                      </p>
                      <div className="stock">
                        <strong>{r.quantity.toLocaleString()}</strong>
                        <span>{r.unit} available</span>
                      </div>
                      {canManage && (
                        <button
                          className="secondary full"
                          onClick={() => open("restock", r)}
                        >
                          <Plus size={16} />
                          Restock
                        </button>
                      )}
                    </article>
                  ))}
                  {!matching(state.resources).length && (
                    <div className="panel empty">
                      <Boxes />
                      <h3>No resources found</h3>
                      <p>Add supplies to begin fulfilling relief requests.</p>
                    </div>
                  )}
                </section>
              )}
              {tab === "Response teams" && (
                <section className="card-grid">
                  {matching(state.teams).map((t) => (
                    <article className="resource-card" key={t.id}>
                      <div className="resource-heading">
                        <Shield size={23} />
                        <span className="badge responding">
                          {active.filter((i) => i.team_id === t.id).length}{" "}
                          assignments
                        </span>
                      </div>
                      <h2>{t.name}</h2>
                      <p>{t.specialty}</p>
                      <div className="stock">
                        <strong>{t.personnel}</strong>
                        <span>personnel</span>
                      </div>
                      <p>
                        <MapPin size={14} />
                        {t.location}
                      </p>
                    </article>
                  ))}
                  {!matching(state.teams).length && (
                    <div className="panel empty">
                      <Users />
                      <h3>No teams found</h3>
                      <p>Register a response team to assign it to incidents.</p>
                    </div>
                  )}
                </section>
              )}
              {tab === "Relief requests" && (
                <section className="panel table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Incident</th>
                        <th>Supply requested</th>
                        <th>Quantity</th>
                        <th>Status</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {matching(
                        state.requests.map((r) => ({
                          ...r,
                          incident: incidents.find(
                            (i) => i.id === r.incident_id,
                          )?.title,
                          resource: state.resources.find(
                            (s) => s.id === r.resource_id,
                          )?.name,
                        })),
                      ).map((r) => (
                        <tr key={r.id}>
                          <td>{r.incident}</td>
                          <td>{r.resource}</td>
                          <td className="number">{r.quantity}</td>
                          <td>
                            <Badge value={r.status} />
                          </td>
                          <td>
                            {r.status === "pending" && canRespond && (
                              <div className="inline-actions">
                                <button
                                  className="primary small"
                                  disabled={busy}
                                  onClick={() => open("fulfill", r)}
                                >
                                  Dispatch
                                </button>
                                <button
                                  className="text-button"
                                  disabled={busy}
                                  onClick={() => open("cancel", r)}
                                >
                                  Cancel
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!state.requests.length && (
                    <div className="empty">
                      <ClipboardList />
                      <h3>No relief requests yet</h3>
                      <p>
                        Create a request for an active incident and a registered
                        supply.
                      </p>
                    </div>
                  )}
                </section>
              )}
              {tab === "Access" && canManage && (
                <section className="panel table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Member</th>
                        <th>Role</th>
                        <th>Manage</th>
                      </tr>
                    </thead>
                    <tbody>
                      {state.members.map((m) => (
                        <tr key={m.id}>
                          <td>
                            {m.name}
                            {m.id === state.user.id ? " (you)" : ""}
                          </td>
                          <td>
                            <Badge value={m.role} />
                          </td>
                          <td>
                            {m.id !== state.user.id && (
                              <button
                                className="secondary small"
                                onClick={() => open("role", m)}
                              >
                                Change role
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="panel-note">
                    New members join as reporters. Coordinators manage stock,
                    teams, and access. Responders can assign teams and dispatch
                    supplies.
                  </p>
                </section>
              )}
            </>
          )}
          <footer>
            <span>RELIEF DESK</span>
            <span>Shared awareness. Coordinated action.</span>
            <span>Cloud computing course project</span>
          </footer>
        </main>
      </div>
      <dialog
        aria-labelledby="dialog-title"
        ref={dialog}
        onCancel={(e) => {
          if (busy) e.preventDefault();
          else setModal(null);
        }}
        onClose={() => setModal(null)}
      >
        <div className="dialog-header">
          <div className="eyebrow">COORDINATION DESK</div>
          <button
            className="icon"
            aria-label="Close dialog"
            disabled={busy}
            onClick={() => setModal(null)}
          >
            <X size={21} />
          </button>
        </div>
        <h2 id="dialog-title">
          {modal === "detail"
            ? selected?.title
            : (
                {
                  incident: "Report an incident",
                  status: "Coordinate response",
                  resource: "Register relief supplies",
                  restock: "Restock supplies",
                  team: "Add a response team",
                  request: "Request relief",
                  fulfill: "Confirm supply dispatch",
                  cancel: "Cancel relief request",
                  role: "Change member role",
                } as Row
              )[modal || ""]}
        </h2>
        {error && (
          <div role="alert" className="alert">
            {error}
          </div>
        )}
        {modal === "detail" && selected ? (
          <div className="details">
            <div className="inline-actions">
              <Badge value={selected.severity} />
              <Badge value={selected.status} />
            </div>
            <p>{selected.description}</p>
            <dl>
              <dt>Location</dt>
              <dd>{selected.location}</dd>
              <dt>Disaster type</dt>
              <dd>{selected.type}</dd>
              <dt>People affected</dt>
              <dd>{selected.people}</dd>
              <dt>Reported</dt>
              <dd>{new Date(selected.created_at).toLocaleString()}</dd>
              <dt>Response team</dt>
              <dd>
                {state?.teams.find((t) => t.id === selected.team_id)?.name ||
                  "Unassigned"}
              </dd>
            </dl>
            {selected.lat !== null && selected.lng !== null && (
              <a
                className="text-button"
                target="_blank"
                rel="noreferrer"
                href={`https://www.openstreetmap.org/?mlat=${selected.lat}&mlon=${selected.lng}#map=13/${selected.lat}/${selected.lng}`}
              >
                View location on map <ArrowUpRight size={16} />
              </a>
            )}
            {canRespond && selected.status !== "resolved" && (
              <button
                className="primary full"
                onClick={() => open("status", selected)}
              >
                Coordinate response
              </button>
            )}
          </div>
        ) : (
          <form onSubmit={submit} key={`${modal}-${selected?.id || ""}`}>
            {modal === "incident" && (
              <>
                <Field
                  name="title"
                  maxLength={120}
                  placeholder="e.g. Flooding near the river crossing"
                />
                <div className="form-grid">
                  <label className="field">
                    <span>Disaster type</span>
                    <select name="type">
                      {[
                        "Flood",
                        "Earthquake",
                        "Fire",
                        "Cyclone",
                        "Landslide",
                        "Other",
                      ].map((t) => (
                        <option key={t}>{t}</option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Priority</span>
                    <select name="severity" defaultValue="high">
                      {["critical", "high", "medium", "low"].map((s) => (
                        <option key={s} value={s}>
                          {label(s)}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <Field
                  name="location"
                  maxLength={120}
                  placeholder="Locality, district, state"
                />
                <label className="field">
                  <span>Situation report</span>
                  <textarea
                    name="description"
                    minLength={10}
                    maxLength={2000}
                    required
                    rows={3}
                    placeholder="Describe the situation and assistance needed."
                  />
                </label>
                <Field
                  name="people"
                  type="number"
                  min={0}
                  max={1000000}
                  defaultValue={0}
                >
                  Estimated people affected
                </Field>
                <div className="form-grid">
                  <Field
                    name="lat"
                    type="number"
                    step="any"
                    min={-90}
                    max={90}
                    required={false}
                  >
                    Latitude (optional)
                  </Field>
                  <Field
                    name="lng"
                    type="number"
                    step="any"
                    min={-180}
                    max={180}
                    required={false}
                  >
                    Longitude (optional)
                  </Field>
                </div>
              </>
            )}
            {modal === "status" && (
              <>
                <label className="field">
                  <span>Status</span>
                  <select name="status" defaultValue={selected?.status}>
                    {[
                      selected?.status,
                      ...((
                        {
                          reported: ["responding", "resolved"],
                          responding: ["contained", "resolved"],
                          contained: ["responding", "resolved"],
                        } as Row
                      )[selected?.status || ""] || []),
                    ].map((s: string) => (
                      <option key={s} value={s}>
                        {label(s)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Assigned response team</span>
                  <select name="teamId" defaultValue={selected?.team_id || ""}>
                    <option value="">Unassigned</option>
                    {state?.teams.map((t) => (
                      <option value={t.id} key={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
            {(modal === "resource" || modal === "team") && (
              <>
                <Field name="name" maxLength={120} />
                <Field name="location" maxLength={120} />
                {modal === "resource" ? (
                  <>
                    <Field
                      name="unit"
                      maxLength={120}
                      placeholder="e.g. kits, litres, blankets"
                    />
                    <Field
                      name="quantity"
                      type="number"
                      min={0}
                      max={1000000}
                    />
                  </>
                ) : (
                  <>
                    <Field
                      name="specialty"
                      maxLength={120}
                      placeholder="e.g. Water rescue, medical response"
                    />
                    <Field
                      name="personnel"
                      type="number"
                      min={1}
                      max={1000000}
                    />
                  </>
                )}
              </>
            )}
            {modal === "restock" && (
              <>
                <p>
                  {selected?.name} · {selected?.quantity} {selected?.unit}{" "}
                  currently available
                </p>
                <Field name="quantity" type="number" min={1} max={1000000}>
                  Quantity to add
                </Field>
              </>
            )}
            {modal === "request" && (
              <>
                <label className="field">
                  <span>Active incident</span>
                  <select name="incidentId" required defaultValue="">
                    <option value="" disabled>
                      Select incident
                    </option>
                    {active.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.title}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Relief supply</span>
                  <select name="resourceId" required defaultValue="">
                    <option value="" disabled>
                      Select supply
                    </option>
                    {state?.resources.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name} · {r.quantity} {r.unit} available
                      </option>
                    ))}
                  </select>
                </label>
                <Field name="quantity" type="number" min={1} max={1000000} />
              </>
            )}
            {(modal === "fulfill" || modal === "cancel") && (
              <p>
                {modal === "fulfill"
                  ? `Dispatch ${selected?.quantity} units of ${state?.resources.find((r) => r.id === selected?.resource_id)?.name}? Available inventory will be deducted atomically.`
                  : "Cancel this pending request? No inventory will be deducted."}
              </p>
            )}
            {modal === "role" && (
              <label className="field">
                <span>Role for {selected?.name}</span>
                <select name="role" defaultValue={selected?.role}>
                  {["reporter", "responder", "coordinator"].map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </select>
              </label>
            )}
            <div className="dialog-actions">
              <button
                className="secondary"
                type="button"
                disabled={busy}
                onClick={() => setModal(null)}
              >
                Close
              </button>
              <button className="primary" disabled={busy || !state}>
                {busy
                  ? "Saving…"
                  : modal === "fulfill"
                    ? "Confirm dispatch"
                    : modal === "cancel"
                      ? "Cancel request"
                      : "Save changes"}
              </button>
            </div>
          </form>
        )}
      </dialog>
    </>
  );
}
