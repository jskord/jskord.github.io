// scripts/build-osha-data.mjs
// Node >= 20 (global fetch)

import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

// ---------- config ----------
const SIR_URL =
  process.env.SIR_URL ??
  "https://www.osha.gov/sites/default/files/severe_injury_reports.csv";

const DAYS = Number(process.env.DAYS ?? "90");
const STATE = (process.env.STATE ?? "WI").toUpperCase();
const OUT_DIR = resolve("data");

// Network/header tuning (override via env if needed)
const DEFAULT_UA =
  process.env.FETCH_UA ||
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 (GitHubActionsBot)";
const DEFAULT_REFERER = process.env.FETCH_REFERER || ""; // set if your source checks referer
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
          "Accept":
            "text/csv,application/octet-stream;q=0.9,text/plain;q=0.8,*/*;q=0.7",
          "Accept-Language": "en-US,en;q=0.9",
          ...(DEFAULT_REFERER ? { Referer: DEFAULT_REFERER } : {}),
        },
        redirect: "follow",
      });

      const ctype = res.headers.get("content-type") || "";
      if (!res.ok) {
        const body = await safePeek(res);
        console.error(`[fetchCSV] HTTP ${res.status} ${res.statusText} (${ctype})`);
        throw new Error(`HTTP ${res.status} ${res.statusText} (${ctype}) — ${body}`);
      }

      const text = await res.text();
      if (ctype.includes("text/html") || looksLikeHTML(text)) {
        console.error("[fetchCSV] Received HTML (likely blocked by host/CDN)");
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
  throw new Error(`Failed to fetch SIR CSV after retries: ${lastErr?.message || lastErr}`);
}

function looksLikeHTML(s) {
  const head = s.slice(0, 300).toLowerCase();
  return head.includes("<!doctype html") || head.includes("<html");
}

async function safePeek(res) {
  try {
    const t = await res.text();
    return t.slice(0, 300).replace(/\s+/g, " ");
  } catch {
    return "";
  }
}

function parseCSV(text) {
  // simple CSV parser (handles quoted fields and commas)
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
      // Support escaped quotes ("")
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

function topCounts(items, keyFn, limit = 5) {
  const counts = new Map();
  for (const it of items) {
    const k = keyFn(it);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
}

// ---------- main transform ----------
function filterAndNormalize(rows) {
  const kept = rows
    .filter((r) => {
      const okDate = r.Date && withinDays(r.Date, DAYS);
      const okState = STATE === "ALL" ? true : (r.State || "").toUpperCase() === STATE;
      return okDate && okState;
    })
    .map((r) => ({
      date: r.Date,
      employer: r.Employer || r["Employer"] || "",
      address: r.Address || "",
      city: r.City || "",
      state: r.State || "",
      naics: r["NAICS Code"] || r.NAICS || "",
      description: r["Injury Description"] || r.Description || "",
      hospitalization: String(r["Hospitalized?"] || "").toLowerCase().startsWith("y"),
      amputation: String(r["Amputation?"] || "").toLowerCase().startsWith("y"),
      lossOfEye: String(r["Loss of an Eye?"] || "").toLowerCase().startsWith("y"),
    }));

  const total = kept.length;
  const counts = {
    hospitalization: kept.filter((i) => i.hospitalization).length,
    amputation: kept.filter((i) => i.amputation).length,
    lossOfEye: kept.filter((i) => i.lossOfEye).length,
  };

  const byNAICS = topCounts(kept, (it) => it.naics || "unknown", 5);
  const byCity = topCounts(
    kept,
    (it) => `${(it.city || "").trim()}, ${(it.state || "").trim()}`.trim(),
    5
  );

  return { incidents: kept, summaryStats: { total, counts, byNAICS, byCity } };
}

async function maybeLLMSummary(incidents, stats) {
  const key = process.env.OPENAI_API_KEY || process.env.LLM_API_KEY;
  if (!key) return null;

  const url = process.env.LLM_API_URL || "https://api.openai.com/v1/chat/completions";
  const model = process.env.LLM_MODEL || "gpt-4o-mini";

  const bullets = incidents
    .slice(0, 40)
    .map((i) => `• ${i.date} — ${i.employer} (${i.naics}): ${i.description}`)
    .join("\n");

  const sys = `You are an OSHA/EHS analyst. Write a concise 150–180 word brief for safety leaders. Summarize 3 trends from the last ${DAYS} days, highlight top mechanisms/risks, map to likely OSHA standards (cite numbers only), and list 4 practical controls. Neutral tone.`;
  const user = `Scope: ${STATE === "ALL" ? "All states" : STATE}. Stats: ${JSON.stringify(
    stats
  )}. Incidents (sample):\n${bullets}`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: sys },
        { role: "user", content: user },
      ],
      temperature: 0.3,
      max_tokens: 350,
    }),
  });

  if (!res.ok) {
    console.error("LLM error", await res.text().catch(() => ""));
    return null;
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() || null;
}

// ---------- main ----------
async function main() {
  console.log("Starting OSHA data build...");
  console.log("Working directory:", process.cwd());
  console.log("SIR_URL:", SIR_URL);
  console.log("STATE:", STATE, "DAYS:", DAYS);

  mkdirSync(OUT_DIR, { recursive: true });

  // 1) Fetch CSV
  const csv = await fetchCSV(SIR_URL);

  // 2) Parse + filter
  const rows = parseCSV(csv);
  console.log(`Parsed ${rows.length.toLocaleString()} CSV rows`);
  const { incidents, summaryStats } = filterAndNormalize(rows);
  console.log(`Kept ${summaryStats.total.toLocaleString()} incidents for STATE=${STATE}, DAYS=${DAYS}`);

  // 3) Write outputs
  const incidentsPath = resolve(OUT_DIR, "osha-incidents.json");
  const summaryPath = resolve(OUT_DIR, "osha-summary.json");
  console.log("Writing outputs to:", OUT_DIR);
  console.log("Files:", incidentsPath, summaryPath);

  writeFileSync(
    incidentsPath,
    JSON.stringify(
      { updated: new Date().toISOString(), state: STATE, days: DAYS, incidents },
      null,
      2
    )
  );

  const ai = await maybeLLMSummary(incidents, summaryStats);

  writeFileSync(
    summaryPath,
    JSON.stringify(
      {
        updated: new Date().toISOString(),
        state: STATE,
        days: DAYS,
        stats: summaryStats,
        ai_summary: ai,
      },
      null,
      2
    )
  );

  console.log(
    `Wrote ${incidents.length} incidents to /data and summary ${ai ? "with" : "without"} AI.`
  );
}

main().catch((err) => {
  console.error("❌ BUILD FAILED:", err);
  process.exit(1);
});
