// update.js (ESM)

import 'dotenv/config';
import OpenAI from 'openai';
import { promises as fs } from 'fs';

// ===== Config =====
const OUTPUT_FILE = 'historical-news.html';
const MODEL_TEXT = 'gpt-4o-mini';
const MODEL_IMAGE = 'gpt-image-1'; // used only if GENERATE_IMAGE=true
const GENERATE_IMAGE = process.env.GENERATE_IMAGE === 'true'; // opt-in for image
const TIMEZONE = 'America/Chicago';

// ===== Helpers =====
function getChicagoNow() {
  // JS Date is system TZ; we’ll format with toLocaleString using America/Chicago.
  return new Date();
}

function formatChicago(dt) {
  return dt.toLocaleString('en-US', {
    timeZone: TIMEZONE,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
  });
}

function date100YearsAgo(dt) {
  const d = new Date(dt);
  d.setFullYear(d.getFullYear() - 100);
  return d;
}

function formatChicagoDateOnly(dt) {
  return dt.toLocaleDateString('en-US', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

// ===== Main =====
const openai = new OpenAI();

async function generateText(targetDateLabel) {
  const systemPrompt = `You are a newspaper journalist writing on ${targetDateLabel} (100 years ago relative to today in America/Chicago). Be concise, factual, and readable.`;

  const userPrompt = `Write a brief, punchy summary (2–4 sentences) of notable world news items from ${targetDateLabel}. 
Avoid anachronisms. If uncertain, say so briefly rather than inventing facts.`;

  // Responses API (preferred)
  const res = await openai.responses.create({
    model: MODEL_TEXT,
    input: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.7,
    max_output_tokens: 300,
  });

  const text = res.output_text?.trim() || '';
  if (!text) throw new Error('Empty text from model');
  return text;
}

async function generateImage(targetDateLabel) {
  // A generic historically-styled illustration prompt
  const prompt = `A sepia-toned, newspaper-style illustration representing world events from ${targetDateLabel}, 
with subtle vintage textures and simple iconography (no text).`;

  const img = await openai.images.generate({
    model: MODEL_IMAGE,
    prompt,
    size: '1024x1024',
  });

  const b64 = img.data?.[0]?.b64_json;
  if (!b64) throw new Error('Empty image from model');
  return `data:image/png;base64,${b64}`;
}

async function writeHtml({ text, imageDataUrl, updatedLabel }) {
  const imageBlock = imageDataUrl
    ? `<div style="text-align:center;margin:1.25rem 0;">
         <img alt="Historical illustration" src="${imageDataUrl}" style="max-width:100%;height:auto;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.08);" />
       </div>`
    : '';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Daily Historical News</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Inter, "Helvetica Neue", Arial, "Noto Sans", "Apple Color Emoji", "Segoe UI Emoji"; margin: 2em; line-height: 1.6; color: #333; }
    .fact { background: #f0f8ff; border: 1px solid #cce7ff; border-left: 8px solid #007bff; border-radius: 10px; padding: 1.25rem 1.5rem; max-width: 760px; margin: 0 auto; box-shadow: 0 4px 12px rgba(0,0,0,.08);}
    h1 { text-align: center; color: #0056b3; margin-bottom: 1rem; }
    .updated { font-size: .875rem; color: #6c757d; text-align: right; border-top: 1px dashed #e9ecef; padding-top: .5rem; margin-top: 1rem; }
    .text { font-size: 1.1rem; font-weight: 600; margin-bottom: .75rem; }
  </style>
</head>
<body>
  <h1>100 Years Ago Today, This is What Was Happening ...</h1>
  <div class="fact">
    ${imageBlock}
    <div class="text">${text.replace(/\n/g, '<br/>')}</div>
    <div class="updated">Updated: ${updatedLabel}</div>
  </div>
</body>
</html>`.trim();

  await fs.writeFile(OUTPUT_FILE, html, 'utf8');
}

async function main() {
  try {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is not set.');
    }

    const now = getChicagoNow();
    const target = date100YearsAgo(now); // exact same month/day in 1925
    const targetDateLabel = formatChicagoDateOnly(target);
    const updatedLabel = formatChicago(now);

    console.log(`Generating content for ${targetDateLabel}…`);
    const text = await generateText(targetDateLabel);

    let imageDataUrl = null;
    if (GENERATE_IMAGE) {
      console.log('Generating image…');
      imageDataUrl = await generateImage(targetDateLabel);
    }

    await writeHtml({ text, imageDataUrl, updatedLabel });
    console.log(`✅ Wrote ${OUTPUT_FILE}`);
  } catch (err) {
    console.error('❌ Error:', err?.message || err);

    const now = getChicagoNow();
    const updatedLabel = formatChicago(now);
    const errorHtml = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>Error</title>
<style>body{font-family:Segoe UI,Roboto,Inter,Arial;margin:2em;line-height:1.6;color:#333}
.err{background:#ffe0e0;border:1px solid #ff9999;border-left:8px solid #dc3545;border-radius:10px;padding:1.25rem 1.5rem;max-width:760px;margin:0 auto;box-shadow:0 4px 12px rgba(0,0,0,.08)}
.updated{font-size:.875rem;color:#6c757d;text-align:right;border-top:1px dashed #ffcccb;padding-top:.5rem;margin-top:1rem}
</style></head>
<body><h1>Error Generating Content</h1>
<div class="err">
  <p>We apologize, but there was an issue generating the daily historical news fact.</p>
  <p style="color:#dc3545">Error details: ${String(err?.message || err)}</p>
  <div class="updated">Updated: ${updatedLabel}</div>
</div></body></html>`;
    await fs.writeFile(OUTPUT_FILE, errorHtml, 'utf8').catch(()=>{});
    process.exit(1);
  }
}

main();