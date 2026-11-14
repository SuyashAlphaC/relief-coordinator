"use client";
import { useRef, useState } from "react";
import { MapPin } from "lucide-react";
export function Coordinates({
  lat,
  lng,
  required = false,
}: {
  lat?: number | null;
  lng?: number | null;
  required?: boolean;
}) {
  const latitude = useRef<HTMLInputElement>(null),
    longitude = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState("");
  const [locating, setLocating] = useState(false);
  const locate = () => {
    if (!navigator.geolocation) {
      setMessage("Location is unavailable. Enter coordinates manually.");
      return;
    }
    setLocating(true);
    setMessage("");
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        if (latitude.current)
          latitude.current.value = coords.latitude.toFixed(6);
        if (longitude.current)
          longitude.current.value = coords.longitude.toFixed(6);
        setMessage(
          "Current device location filled. Verify it matches the incident or team's actual position.",
        );
        setLocating(false);
      },
      () => {
        setMessage(
          "Could not obtain location. Enter latitude and longitude manually.",
        );
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  };
  return (
    <fieldset className="coordinates">
      <legend>Coordinates for nearest-team assignment</legend>
      <div className="form-grid">
        <label className="field">
          <span>Latitude</span>
          <input
            ref={latitude}
            name="lat"
            type="number"
            step="any"
            min={-90}
            max={90}
            required={required}
            defaultValue={lat ?? ""}
          />
        </label>
        <label className="field">
          <span>Longitude</span>
          <input
            ref={longitude}
            name="lng"
            type="number"
            step="any"
            min={-180}
            max={180}
            required={required}
            defaultValue={lng ?? ""}
          />
        </label>
      </div>
      <button
        type="button"
        className="secondary small"
        onClick={locate}
        disabled={locating}
      >
        <MapPin size={14} />
        {locating ? "Locating…" : "Use my current location"}
      </button>
      <p className="muted">
        {required
          ? "Enter the actual position. "
          : "You can save without coordinates, but automatic assignment will wait. "}
        Distance is straight-line, not road travel time.
      </p>
      <p role="status">{message}</p>
    </fieldset>
  );
}
export function assignmentLabel(incident: Record<string, any>) {
  switch (incident.assignment_state) {
    case "assigned":
      return `Automatically assigned${incident.assignment_distance_km != null ? ` · ${Number(incident.assignment_distance_km).toFixed(1)} km away` : ""}`;
    case "needs_location":
      return "Waiting for incident coordinates";
    case "no_team":
      return "Waiting for an available team with coordinates";
    case "pending":
      return "Finding nearest available team";
    default:
      return incident.team_id ? "Manually assigned" : "Manual assignment";
  }
}
