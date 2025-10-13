// scripts/build-echo-data.mjs
// Node >= 20 (global fetch)

import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

// ---------- config ----------
const ECHO_URL = process.env.ECHO_URL; // REQUIRED
if (!ECHO_URL) {
  console.error("Missing ECHO_URL env. Set a downloadable ECHO CSV link.");
  process.exit(1);
}

const DAYS = Number(process.env.DAYS ?? "365");
const STATE = (process.env.STATE ?? "WI").toUpperCase();
const OUT_DIR = resolve("data");

// Network/header tuning (override via env if needed)
const DEFAULT_UA =
  process.env.FETCH_UA ||
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 (GitHubActionsBot)";
const MAX_RETRIES = Number(process.env.FETCH_RETRIES ?? "4");
const BACKOFF_MS = Number(process.env.FETCH_BACKOFF_MS ?? "750");

// ---------- helpers ----------
async function fetchCSV(url) {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(`[fetchCSV] GET ${url} (attempt ${attempt}/${MAX_RETRIES})`);
      const res = await fetch(url, {
        headers: {
          "User-Agent": DEFAULT_UA,
          "Accept": "text/csv,application/octet-stream;q=0.9,text/plain;q=0.8,*/*;q=0.7",
          "Accept-Language": "en-US,en;q=0.9",
        },
        redirect: "follow",
      });
      const ctype = res.headers.get("content-type") || "";
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        console.error(`[fetchCSV] HTTP ${res.status} ${res.statusText} (${ctype})`);
        throw new Error(`HTTP ${res.status} ${res.statusText} — ${body.slice(0, 300)}`);
      }
      const text = await res.text();
      if ((ctype.includes("text/html")) || looksLikeHTML(text)) {
        throw new Error(`Unexpected HTML response (likely blocked). content-type=${ctype}`);
      }
      console.log(`[fetchCSV] OK (${text.length.toLocaleString()} bytes)`);
      return text;
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_RETRIES) {
        const wait = BACKOFF_MS * Math.pow(2, attempt - 1);
        console.warn(`[fetchCSV] attempt ${attempt} failed: ${err.message}. Retrying in ${wait}ms...`);
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  }
  throw new Error(`Failed to fetch ECHO CSV after retries: ${lastErr?.message || lastErr}`);
}

function looksLikeHTML(s) {
  const head = s.slice(0, 300).toLowerCase();
  return head.includes("<!doctype html") || head.includes("<html");
}

function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const header = splitCSVLine(lines.shift() || "");
  return lines.map((line) => {
    const cols = splitCSVLine(line);
    const row = {};
    header.forEach((h, i) => {
      row[h] = (cols[i] ?? "").trim();
    });
    return row;
  });
}

function splitCSVLine(line) {
  const out = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQ = !inQ;
      }
      continue;
    }
    if (ch === "," && !inQ) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function withinDays(dateStr, days) {
  const t = new Date(dateStr).getTime();
  if (Number.isNaN(t)) return false;
  const cutoff = Date.now() - days * 86400_000;
  return t >= cutoff;
}

function toNumber(x) {
  const n = Number(String(x).replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function normalizeRow(r) {
  // ECHO CSVs vary. We coalesce common column names across ECHO downloads.
  // Adjust these mappings to your chosen CSV if needed.
  const prog =
    r.Program || r.PROGRAM || r.Media || r.MEDIA || r.ProgramCategory || r.Sector || "";
  const fac =
    r.FacilityName || r.FACILITY_NAME || r.Name || r.Facility || r.FAC_NAME || "";
  const city = r.City || r.CITY || "";
  const state = r.State || r.STATE || "";
  const naics = r.NAICS || r.NAICSCode || r.NAICS_CODE || r["NAICS Code"] || "";
  const permit = r.PermitID || r.PERMIT_ID || r.Permit || r.PermitNumber || "";
  const penalties = toNumber(r.TotalPenalties || r.Penalties || r.PENALTIES || r.PenaltyAmount);
  const lastInsp =
    r.LastInspectionDate || r.InspectionEndDate || r.InspectionDate ||
    r.LAST_INSPECTION_DATE || r.InspDate || r.Insp_End_Date || "";
  const lastEnf =
    r.LastPenaltyDate || r.EnforcementActionDate || r.CaseDate ||
    r.LAST_PENALTY_DATE || r.EnfDate || "";
  const actionFlags =
    (r.AccidentFlag || r.IncidentFlag || r.FATALITY_FLAG || r.FatalityFlag || r.Accident || "");

  // Pick an "event date" for recency: most recent of inspection/enforcement
  const eventDate = pickMostRecentDate([lastEnf, lastInsp]);

  return {
    program: prog,
    facility: fac,
    city,
    state,
    naics,
    permit,
    penalties,
    lastInspectionDate: lastInsp,
    lastEnforcementDate: lastEnf,
    eventDate,
    flags: String(actionFlags || "").toUpperCase(),
    raw: r,
  };
}

function pickMostRecentDate(arr) {
  let best = null;
  for (const s of arr) {
    const t = new Date(s).getTime();
    if (!Number.isNaN(t)) {
      if (best === null || t > best) best = t;
    }
  }
  return best ? new Date(best).toISOString() : null;
}

function topCounts(items, keyFn, limit = 5) {
  const counts = new Map();
  for (const it of items) {
    const k = keyFn(it);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
}

function filterAndSummarize(rows) {
  const normalized = rows.map(normalizeRow);

  const kept = normalized.filter((r) => {
    const okState = STATE === "ALL" ? true : (r.state || "").toUpperCase() === STATE;
    const okDate = r.eventDate ? withinDays(r.eventDate, DAYS) : false;
    return okState && okDate;
  });

  const total = kept.length;
  const byProgram = topCounts(kept, (it) => it.program || "Unknown", 6);
  const byCity = topCounts(kept, (it) => `${(it.city || "").trim()}, ${(it.state || "").trim()}`.trim(), 6);

  const inspections = kept.filter(k => k.lastInspectionDate && withinDays(k.lastInspectionDate, DAYS)).length;
  const enforcements = kept.filter(k => k.lastEnforcementDate && withinDays(k.lastEnforcementDate, DAYS)).length;
  const penaltiesSum = kept.reduce((s, k) => s + (k.penalties || 0), 0);

  // dataset coverage window (from the raw CSV)
  const allDates = normalized
    .map(k => new Date(k.eventDate || k.lastEnforcementDate || k.lastInspectionDate).getTime())
    .filter(t => !Number.isNaN(t));
  const datasetRange = {
    min: allDates.length ? new Date(Math.min(...allDates)).toISOString() : null,
    max: allDates.length ? new Date(Math.max(...allDates)).toISOString() : null,
  };

  return {
    incidents: kept,
    summary: {
      total,
      counts: { inspections, enforcements },
      penaltiesSum,
      byProgram,
      byCity,
      datasetRange,
    }
  };
}

async function main() {
  console.log("Starting EPA ECHO build...");
  console.log("Working directory:", process.cwd());
  console.log("ECHO_URL:", ECHO_URL);
  console.log("STATE:", STATE, "DAYS:", DAYS);

  mkdirSync(OUT_DIR, { recursive: true });

  const csv = await fetchCSV(ECHO_URL);
  const rows = parseCSV(csv);
  console.log(`Parsed ${rows.length.toLocaleString()} CSV rows`);

  const { incidents, summary } = filterAndSummarize(rows);
  console.log(`Kept ${summary.total.toLocaleString()} records for STATE=${STATE}, DAYS=${DAYS}`);

  const incidentsPath = resolve(OUT_DIR, "epa-incidents.json");
  const summaryPath = resolve(OUT_DIR, "epa-summary.json");

  writeFileSync(
    incidentsPath,
    JSON.stringify(
      { updated: new Date().toISOString(), state: STATE, days: DAYS, incidents },
      null,
      2
    )
  );

  writeFileSync(
    summaryPath,
    JSON.stringify(
      { updated: new Date().toISOString(), state: STATE, days: DAYS, stats: summary },
      null,
      2
    )
  );

  console.log(
    `Wrote ${incidents.length} incidents to /data and summary.`
  );
}

main().catch((err) => {
  console.error("❌ BUILD FAILED:", err);
  process.exit(1);
});
