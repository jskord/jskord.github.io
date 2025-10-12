// scripts/build-osha-data.mjs
// Node >= 20 (global fetch)

import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const SIR_URL =
  process.env.SIR_URL ??
  "https://www.osha.gov/sites/default/files/severe_injury_reports.csv";

const DAYS = Number(process.env.DAYS ?? "90");
const STATE = (process.env.STATE ?? "WI").toUpperCase();
const OUT_DIR = resolve("data");

// ---------- helpers ----------
async function fetchCSV(url) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) {
    throw new Error(`Failed to fetch SIR CSV: ${res.status} ${res.statusText}`);
  }
  return await res.text();
}

function parseCSV(text) {
  // simple CSV parser (no third-party deps)
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
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
      inQ = !inQ;
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
  const byCity = topCounts(kept, (it) => `${it.city || ""}, ${it.state || ""}`.trim(), 5);

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
    console.error("LLM error", await res.text());
    return null;
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() || null;
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  const csv = await fetchCSV(SIR_URL);
  const rows = parseCSV(csv);

  const { incidents, summaryStats } = filterAndNormalize(rows);

  writeFileSync(
    resolve(OUT_DIR, "osha-incidents.json"),
    JSON.stringify(
      { updated: new Date().toISOString(), state: STATE, days: DAYS, incidents },
      null,
      2
    )
  );

  const ai = await maybeLLMSummary(incidents, summaryStats);

  writeFileSync(
    resolve(OUT_DIR, "osha-summary.json"),
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
  console.error(err);
  process.exit(1);
});