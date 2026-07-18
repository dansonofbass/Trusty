"use client";

import { GEO_OPTIONS, geoLabel } from "@constellation/graph-core";

/**
 * Location select — Trusty explores one country at a time (Armenia, v1).
 * Every location input in the app uses this instead of free text: cities of
 * Armenia + districts of Yerevan, canonical lowercase values so trust /
 * recommendation geo matching stays clean equality.
 */
export default function GeoSelect({
  value,
  onChange,
  allowAnywhere = false,
  className,
}: {
  value: string;
  onChange: (geo: string) => void;
  /** Adds an "anywhere in Armenia" empty option (search scopes). */
  allowAnywhere?: boolean;
  className?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={
        className ??
        "rounded bg-[var(--color-tint)] px-1.5 py-1 text-[11.5px] text-ink outline-none"
      }
    >
      {allowAnywhere && <option value="">anywhere in Armenia</option>}
      {GEO_OPTIONS.map((g) => (
        <optgroup key={g.label} label={g.label}>
          {g.options.map((o) => (
            <option key={o} value={o}>
              {geoLabel(o)}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
