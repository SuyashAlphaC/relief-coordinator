import { ArrowUpRight, Plus } from "lucide-react";

export function ResponseCover({
  onExplore,
  active,
  teams,
}: {
  onExplore: () => void;
  active: number;
  teams: number;
}) {
  return (
    <section
      className="response-cover-wrap"
      aria-label="Response workspace introduction"
    >
      <button
        className="response-cover"
        onClick={onExplore}
        aria-label="Explore response network"
      >
        <span className="cover-meta">
          Relief Desk
          <br />
          Emergency coordination
          <br />
          People first —
        </span>
        <span className="cover-meta cover-meta-right">
          Reports
          <br />
          Resources
          <br />
          One shared response.
        </span>
        <span className="cover-spine">
          RELIEF DESK / EVERY RESPONSE. ONE SHARED MISSION.
        </span>
        <svg className="cover-art" viewBox="0 0 400 240" aria-hidden="true">
          <path d="M90 135L290 135M90 148L290 148M193 102L240 160M202 102L249 160" />
          <circle cx="90" cy="140" r="35" />
          <circle cx="290" cy="140" r="35" />
          <path
            className="cover-plus"
            d="M79 140h22M90 129v22M279 140h22M290 129v22"
          />
        </svg>
        <span className="cover-title">
          Ready.
          <br />
          Together.
        </span>
        <span className="cover-bottom">OPERATIONS NOTES — 001</span>
        <span className="cover-count">
          {active} active reports · {teams} teams
        </span>
      </button>
      <button className="cover-explore" onClick={onExplore}>
        Explore the response network <ArrowUpRight size={16} />
      </button>
    </section>
  );
}

export function ResponseNetwork({
  onNavigate,
  active,
  pending,
  teams,
  resources,
}: {
  onNavigate: (tab: string) => void;
  active: number;
  pending: number;
  teams: number;
  resources: number;
}) {
  return (
    <section
      className="response-network"
      id="network"
      aria-labelledby="network-heading"
    >
      <div className="section-intro">
        <h2 id="network-heading">
          One workspace.
          <br />
          Every response connected.
        </h2>
        <p>
          From the first report to the final dispatch. People, evidence, and
          supplies move together in one shared picture.
        </p>
      </div>
      <div className="network-map">
        <svg
          className="network-lines"
          viewBox="0 0 1000 320"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path d="M140 70H270L500 160 730 70H860M140 250H270L500 160 730 250H860" />
          <path className="network-pulse" d="M140 70H270L500 160 730 250H860" />
        </svg>
        <button
          className="network-node node-incidents"
          onClick={() => onNavigate("Incidents")}
        >
          <span>Incident reports</span>
          <strong>
            {active} active <ArrowUpRight size={14} />
          </strong>
        </button>
        <button
          className="network-node node-teams"
          onClick={() => onNavigate("Response teams")}
        >
          <span>Response teams</span>
          <strong>
            {teams} registered <ArrowUpRight size={14} />
          </strong>
        </button>
        <div className="network-center" aria-hidden="true">
          <span className="network-diamond" />
          <span className="network-diamond second" />
          <Plus size={30} />
          <strong>
            relief<span>desk</span>
          </strong>
          <small>SHARED RESPONSE</small>
        </div>
        <button
          className="network-node node-resources"
          onClick={() => onNavigate("Resources")}
        >
          <span>Relief supplies</span>
          <strong>
            {resources} resources <ArrowUpRight size={14} />
          </strong>
        </button>
        <button
          className="network-node node-requests"
          onClick={() => onNavigate("Relief requests")}
        >
          <span>Relief requests</span>
          <strong>
            {pending} pending <ArrowUpRight size={14} />
          </strong>
        </button>
      </div>
      <div className="network-caption">
        <span>CONNECTED BY DESIGN</span>
        <span>Real-time coordination</span>
        <span>Shared evidence</span>
        <span>Accountable action ↗</span>
      </div>
    </section>
  );
}
