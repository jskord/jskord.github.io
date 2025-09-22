// scripts/build-osha-data.mjs
}, {})).sort((a,b)=>b[1]-a[1]).slice(0,5);


return { incidents: keep, summaryStats: { total, counts, byNAICS, byCity } };
}


async function maybeLLMSummary(incidents, stats) {
const key = process.env.OPENAI_API_KEY || process.env.LLM_API_KEY; // optional
const url = process.env.LLM_API_URL || "https://api.openai.com/v1/chat/completions";
const model = process.env.LLM_MODEL || "gpt-4o-mini"; // pick any compatible model name
if (!key) return null; // skip if no key configured


const bullets = incidents.slice(0, 40).map(i => `• ${i.date} — ${i.employer} (${i.naics}): ${i.description}` ).join("\n");
const sys = `You are an OSHA/EHS analyst. Write a concise 150–180 word brief for safety leaders. Summarize 3 trends from the last ${DAYS} days, highlight top mechanisms/risks, map to likely OSHA standards (cite numbers only), and list 4 practical controls. Keep neutral tone.`;
const user = `Scope: ${STATE === "ALL" ? "All states" : STATE}. Stats: ${JSON.stringify(stats)}. Incidents (sample):\n${bullets}`;


const res = await fetch(url, {
method: "POST",
headers: {
"Authorization": `Bearer ${key}`,
"Content-Type": "application/json"
},
body: JSON.stringify({
model,
messages: [
{ role: "system", content: sys },
{ role: "user", content: user }
],
temperature: 0.3,
max_tokens: 350
})
});
if (!res.ok) {
console.error("LLM error", await res.text());
return null;
}
const data = await res.json();
const text = data.choices?.[0]?.message?.content?.trim() || null;
return text;
}


async function main() {
mkdirSync(OUT_DIR, { recursive: true });
const csv = await fetchCSV(SIR_URL);
const rows = parseCSV(csv);
const { incidents, summaryStats } = filterAndNormalize(rows);


writeFileSync(resolve(OUT_DIR, "osha-incidents.json"), JSON.stringify({ updated: new Date().toISOString(), state: STATE, days: DAYS, incidents }, null, 2));


const ai = await maybeLLMSummary(incidents, summaryStats);
const summary = {
updated: new Date().toISOString(),
state: STATE,
days: DAYS,
stats: summaryStats,
ai_summary: ai, // may be null if no key
};
writeFileSync(resolve(OUT_DIR, "osha-summary.json"), JSON.stringify(summary, null, 2));


console.log(`Wrote ${incidents.length} incidents to /data and summary with${ai?"":"out"} AI.`);
}


main().catch(err => { console.error(err); process.exit(1); });