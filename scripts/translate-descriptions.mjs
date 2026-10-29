// Pre-translates the short Russian prisoner descriptions (OVD-Info) into Czech with Claude Sonnet
// and stores them in public/translations-cs.json, so the app shows Czech descriptions instantly.
// Only new or changed descriptions are translated (key: prisoner id + hash of the Russian text).
//
// Usage:
//   node scripts/translate-descriptions.mjs              # Anthropic API directly, ANTHROPIC_API_KEY from .env.local
//   node scripts/translate-descriptions.mjs --via-proxy  # through the app's /api/claude proxy (no key needed locally)
// Env: PRISONERS_URL (default production /api/prisoners), PROXY_URL (default production /api/claude)
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { sD, parseTranslations, textHash } from "../src/prompts.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "public/translations-cs.json");
const PRISONERS_URL = process.env.PRISONERS_URL || "https://dopisyveznum.netlify.app/api/prisoners";
const PROXY_URL = process.env.PROXY_URL || "https://dopisyveznum.netlify.app/api/claude";
const VIA_PROXY = process.argv.includes("--via-proxy");
const MODEL = "claude-sonnet-4-6"; // same as the app's /api/claude default
const BATCH = 22, CONCURRENCY = 4; // ~55 calls for the whole list (proxy allows 60/h per client)

function loadEnv() {
  const f = path.join(ROOT, ".env.local");
  if (!fs.existsSync(f)) return;
  for (const line of fs.readFileSync(f, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

async function claude(text) {
  const messages = [{ role: "user", content: [{ type: "text", text }] }];
  if (VIA_PROXY) {
    const r = await fetch(PROXY_URL, { method: "POST", headers: { "Content-Type": "application/json", "X-Client-Id": "translate-script" }, body: JSON.stringify({ system: sD, messages }) });
    if (!r.ok) throw new Error(`proxy ${r.status}: ${(await r.text()).slice(0, 200)}`);
    let out = "";
    for (const line of (await r.text()).split("\n")) {
      if (!line.startsWith("data: ")) continue;
      try { const p = JSON.parse(line.slice(6)); if (p.type === "content_block_delta" && p.delta?.text) out += p.delta.text; } catch {}
    }
    return out;
  }
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: MODEL, max_tokens: 4000, system: sD, messages }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`Claude ${r.status}: ${j.error?.message || ""}`);
  return j.content.map(c => c.text || "").join("");
}

loadEnv();
if (!VIA_PROXY && !process.env.ANTHROPIC_API_KEY) { console.error("Missing ANTHROPIC_API_KEY in .env.local (or use --via-proxy)"); process.exit(2); }

const list = (await (await fetch(PRISONERS_URL)).json()).prisoners;
const old = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")).t || {} : {};
const t = {};
const need = [];
for (const p of list) {
  if (!p.dr) continue;
  const h = textHash(p.dr);
  if (old[p.i] && old[p.i].h === h) t[p.i] = old[p.i];
  else need.push({ i: p.i, dr: p.dr, h });
}
console.log(`${list.length} prisoners, ${Object.keys(t).length} already translated, ${need.length} to translate`);

const batches = [];
for (let k = 0; k < need.length; k += BATCH) batches.push(need.slice(k, k + BATCH));
let next = 0, done = 0, failed = 0;
const save = () => fs.writeFileSync(OUT, JSON.stringify({ model: MODEL, updated: new Date().toISOString(), t }, null, 0));
async function worker() {
  while (next < batches.length) {
    const b = batches[next++];
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = parseTranslations(await claude(JSON.stringify(Object.fromEntries(b.map(p => [p.i, p.dr])))));
        let got = 0;
        for (const p of b) if (res[p.i] && (!/[\u0400-\u04FF]/.test(res[p.i]) || attempt === 3)) { t[p.i] = { h: p.h, d: res[p.i] }; got++; }
        if (got < b.length && attempt < 3) { b.splice(0, b.length, ...b.filter(p => !res[p.i])); continue; }
        break;
      } catch (e) {
        if (attempt === 3) { failed++; console.error("batch failed:", e.message); }
        else await new Promise(r => setTimeout(r, 5000 * attempt));
      }
    }
    done++;
    if (done % 5 === 0 || done === batches.length) { save(); console.log(`${done}/${batches.length} batches, ${Object.keys(t).length} translated`); }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
save();
console.log(`Done: ${Object.keys(t).length}/${list.filter(p => p.dr).length} translated, ${failed} failed batches -> ${path.relative(ROOT, OUT)}`);
