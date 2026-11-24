import { useEffect, useState } from "react";
import { addToast } from "../toasts";

/** 100-ns intervals between 0001-01-01T00:00:00Z (.NET epoch) and the Unix epoch. */
const DOTNET_EPOCH_TICKS = 621355968000000000n;
/** 100-ns intervals between 1601-01-01T00:00:00Z (Windows FILETIME epoch) and the Unix epoch. */
const FILETIME_EPOCH_TICKS = 116444736000000000n;

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function pad(n: number, width = 2): string {
  return String(n).padStart(width, "0");
}

interface FormatRow {
  name: string;
  hint: string;
  value: string;
}

interface FormatGroup {
  title: string;
  rows: FormatRow[];
}

function buildGroups(d: Date): FormatGroup[] {
  const ms = d.getTime();
  const unixSeconds = Math.floor(ms / 1000);
  const iso = d.toISOString(); // e.g. 2024-11-24T12:34:56.789Z

  const utc = {
    year: d.getUTCFullYear(),
    month: pad(d.getUTCMonth() + 1),
    day: pad(d.getUTCDate()),
    hours: pad(d.getUTCHours()),
    minutes: pad(d.getUTCMinutes()),
    seconds: pad(d.getUTCSeconds()),
    ms: pad(d.getUTCMilliseconds(), 3),
    dayName: DAY_NAMES[d.getUTCDay()],
    monthName: MONTH_NAMES[d.getUTCMonth()],
  };

  // Local timezone offset rendered as +HH:MM (or -HH:MM).
  const offsetMinutes = -d.getTimezoneOffset();
  const offset =
    (offsetMinutes < 0 ? "-" : "+") +
    pad(Math.floor(Math.abs(offsetMinutes) / 60)) +
    ":" +
    pad(Math.abs(offsetMinutes) % 60);

  return [
    {
      title: "Epoch & ticks",
      rows: [
        {
          name: "Unix time",
          hint: "seconds since 1970-01-01",
          value: String(unixSeconds),
        },
        {
          name: "Unix time, ms",
          hint: "milliseconds since 1970-01-01 (JS, Java)",
          value: String(ms),
        },
        {
          name: "Unix time, µs",
          hint: "microseconds since 1970-01-01",
          value: (BigInt(ms) * 1000n).toString(),
        },
        {
          name: ".NET ticks",
          hint: "100-ns since 0001-01-01 AD (C# DateTime.Ticks)",
          value: (BigInt(ms) * 10000n + DOTNET_EPOCH_TICKS).toString(),
        },
        {
          name: "Windows FILETIME",
          hint: "100-ns since 1601-01-01",
          value: (BigInt(ms) * 10000n + FILETIME_EPOCH_TICKS).toString(),
        },
      ],
    },
    {
      title: "ISO 8601",
      rows: [
        { name: "ISO 8601 UTC", hint: "with milliseconds", value: iso },
        {
          name: "ISO 8601 UTC",
          hint: "without milliseconds",
          value: iso.replace(/\.\d+Z$/, "Z"),
        },
        {
          name: "ISO 8601 local",
          hint: `local time with offset (UTC${offset})`,
          value:
            `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
            `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${offset}`,
        },
        {
          name: "ISO 8601 basic",
          hint: "compact form, UTC",
          value: `${utc.year}${utc.month}${utc.day}T${utc.hours}${utc.minutes}${utc.seconds}Z`,
        },
        {
          name: "ISO 8601 date",
          hint: "UTC date only",
          value: `${utc.year}-${utc.month}-${utc.day}`,
        },
      ],
    },
    {
      title: "Other formats",
      rows: [
        {
          name: "RFC 2822",
          hint: "email Date header, UTC",
          value: `${utc.dayName}, ${utc.day} ${utc.monthName} ${utc.year} ${utc.hours}:${utc.minutes}:${utc.seconds} +0000`,
        },
        {
          name: "RFC 1123 / HTTP",
          hint: "HTTP Date header, GMT",
          value: `${utc.dayName}, ${utc.day} ${utc.monthName} ${utc.year} ${utc.hours}:${utc.minutes}:${utc.seconds} GMT`,
        },
        {
          name: "SQL timestamp",
          hint: "YYYY-MM-DD HH:mm:ss, UTC",
          value: `${utc.year}-${utc.month}-${utc.day} ${utc.hours}:${utc.minutes}:${utc.seconds}`,
        },
        {
          name: "SQL timestamp, ms",
          hint: "YYYY-MM-DD HH:mm:ss.SSS, UTC",
          value: `${utc.year}-${utc.month}-${utc.day} ${utc.hours}:${utc.minutes}:${utc.seconds}.${utc.ms}`,
        },
        {
          name: "Local system time",
          hint: "as displayed on this machine",
          value: d.toString(),
        },
      ],
    },
  ];
}

async function copyValue(value: string, name: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value);
    addToast(`Copied ${name} to clipboard`, "success");
  } catch {
    addToast("Failed to copy to clipboard", "error");
  }
}

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * Tools modal: reference of date/time formats. "Now" fills every field with
 * the current instant rendered in that format; each value is copyable.
 */
export function ToolsDialog({ open, onClose }: Props) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (!open) return;
    setNow(new Date());
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const groups = buildGroups(now);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal tools-modal">
        <div className="tools-header">
          <h2>Tools — date & time formats</h2>
          <span className="spacer" />
          <button className="btn" onClick={onClose}>
            Close
          </button>
          <button className="btn btn-primary" onClick={() => setNow(new Date())}>
            Now
          </button>
        </div>
        <div className="tools-base">
          Base instant: <span className="mono">{now.toString()}</span>
        </div>
        <div className="tools-content">
          {groups.map((group) => (
            <div className="tools-section" key={group.title}>
              <div className="tools-section-title">{group.title}</div>
              {group.rows.map((row) => (
                <div className="tools-row" key={`${row.name} · ${row.hint}`}>
                  <div className="tools-row-label">
                    <span className="tools-row-name">{row.name}</span>
                    <span className="tools-row-hint">{row.hint}</span>
                  </div>
                  <input
                    className="input mono tools-row-value"
                    readOnly
                    value={row.value}
                    onFocus={(e) => e.currentTarget.select()}
                  />
                  <button
                    className="btn tools-copy-btn"
                    title="Copy"
                    onClick={() => void copyValue(row.value, row.name)}
                  >
                    ⎘
                  </button>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
