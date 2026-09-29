// Prompt evals: npm run eval [-- <id-filter>] [--no-ocr] [--runs N]
// Calls the APIs directly with the same model/params as netlify/edge-functions/claude.js
// (Claude) and workers/ocr/worker.js (Gemini). Keys from .env.local.
// Writes evals/results/REPORT.md and raw outputs to evals/results/outputs/.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { sW, sC, sT, sO, sM, sWFix, DUAL_FORM_RE, extractLetter } from "../src/prompts.js";
import { runStreamParserTest } from "./stream-parser.mjs";

const EVALS = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(EVALS, "..");
const RESULTS = path.join(EVALS, "results");

// Must match the production calls
const CLAUDE_MODEL = "claude-sonnet-4-6", CLAUDE_MAX_TOKENS = 4000; // netlify/edge-functions/claude.js
const GEMINI_MODEL = "gemini-3.5-flash";                             // workers/ocr/worker.js
const JUDGE_MODEL = "claude-haiku-4-5";
const CONCURRENCY = 4;

// ---------- env ----------
function loadEnv() {
  const f = path.join(ROOT, ".env.local");
  if (!fs.existsSync(f)) return;
  for (const line of fs.readFileSync(f, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

// ---------- code shared with the app (read from App.jsx so evals test what ships) ----------
const APP_SRC = fs.readFileSync(path.join(ROOT, "src/App.jsx"), "utf8");
const P = new Function("return " + APP_SRC.match(/const P = (\[[\s\S]*?\n\]);/)[1])();
const cleanLetter = new Function(APP_SRC.match(/const cleanLetter = \(s\) => \{[\s\S]*?\n\};/)[0] + ";return cleanLetter;")();
const T = { cs: 0, en: 1, ru: 2 };
const t = (l, c, e, r) => [c, e, r][T[l]];

// ---------- API calls ----------
// Retry transient overload errors (429/500/503/529) with backoff
async function post(url, opts) {
  for (let attempt = 1; ; attempt++) {
    const r = await fetch(url, opts);
    if (![429, 500, 503, 529].includes(r.status) || attempt === 5) return r;
    if (r.status === 429 && /PerDay/.test(await r.clone().text())) return r; // daily quota: retrying only burns requests
    await new Promise(res => setTimeout(res, (r.status === 429 ? 20000 : 10000) * attempt)); // 429 = per-minute quota
  }
}

async function claude(system, text, { model = CLAUDE_MODEL, max_tokens = CLAUDE_MAX_TOKENS, temperature } = {}) {
  const body = { model, max_tokens, system, messages: [{ role: "user", content: [{ type: "text", text }] }] };
  if (temperature !== undefined) body.temperature = temperature;
  const r = await post("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`Claude ${r.status}: ${j.error?.message || JSON.stringify(j).slice(0, 200)}`);
  return j.content.map(c => c.text || "").join("");
}

// Same request shape and text extraction as the Worker (system text first, then images, then text)
async function gemini(system, text, images) {
  const parts = [{ text: system + "\n\n" }];
  for (const im of images) parts.push({ inline_data: { mime_type: im.type, data: im.data } });
  parts.push({ text });
  const r = await post(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:streamGenerateContent?alt=sse`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
    body: JSON.stringify({ contents: [{ parts }] }),
  });
  if (!r.ok) {
    const txt = await r.text();
    let msg; try { msg = JSON.parse(txt).error.message.split("\n").filter(Boolean).slice(-2).join(" "); } catch { msg = txt.slice(0, 300); }
    throw new Error(`Gemini ${r.status}: ${msg}`);
  }
  let out = "";
  for (const line of (await r.text()).split("\n")) {
    if (!line.startsWith("data: ")) continue;
    try { out += JSON.parse(line.slice(6))?.candidates?.[0]?.content?.parts?.[0]?.text || ""; } catch {}
  }
  return out;
}

// ---------- image prep, mirrors resizeImg() / pdfToImages() in App.jsx ----------
async function canvasLib() { return import("@napi-rs/canvas"); }
async function imageToJpeg(file, maxDim = 1500) {
  const { createCanvas, loadImage } = await canvasLib();
  const im = await loadImage(fs.readFileSync(file));
  let w = im.width, h = im.height;
  if (w > maxDim || h > maxDim) { if (w > h) { h = Math.round(h * maxDim / w); w = maxDim; } else { w = Math.round(w * maxDim / h); h = maxDim; } }
  const cv = createCanvas(w, h);
  cv.getContext("2d").drawImage(im, 0, 0, w, h);
  return [{ type: "image/jpeg", data: cv.toBuffer("image/jpeg", 75).toString("base64") }];
}
async function pdfToJpegs(file, maxPages = 10) {
  const { createCanvas } = await canvasLib();
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(file)), verbosity: 0 }).promise;
  const pages = [];
  for (let i = 1; i <= Math.min(doc.numPages, maxPages); i++) {
    const page = await doc.getPage(i);
    let vp = page.getViewport({ scale: 1 });
    vp = page.getViewport({ scale: Math.min(1500 / Math.max(vp.width, vp.height), 3) });
    const cv = createCanvas(Math.floor(vp.width), Math.floor(vp.height));
    await page.render({ canvasContext: cv.getContext("2d"), viewport: vp, canvas: cv }).promise;
    pages.push({ type: "image/jpeg", data: cv.toBuffer("image/jpeg", 75).toString("base64") });
  }
  return pages;
}

// ---------- running a case: same system prompt + user message as the app ----------
const inputOf = c => c.input_file ? fs.readFileSync(path.join(EVALS, c.input_file), "utf8").trim() : c.input;
async function produce(c) {
  const l = c.lang || "cs";
  const input = inputOf(c);
  switch (c.prompt) {
    case "sW": {
      const pr = P.find(p => p.i === c.recipient);
      if (!pr) throw new Error("Unknown recipient " + c.recipient);
      const lt = c.letter_type || "letter", sm = c.send_method || (pr.o ? "online" : "mail");
      const msg = `${t(l, "O mně", "About me", "Обо мне")}: ${input}\n\n${t(l, "Napiš", "Write", "Напиши")} ${lt === "postcard" ? t(l, "pohlednici", "postcard", "открытку") : t(l, "dopis", "letter", "письмо")} pro ${pr.ne}.`;
      // Same flow as gen() in Compose: one repair request if dual gender forms remain
      const sys = sW(l, pr, lt, sm, c.gender || "");
      let letter = cleanLetter(extractLetter(await claude(sys, msg)));
      if (DUAL_FORM_RE.test(letter)) { const fixed = cleanLetter(extractLetter(await claude(sys, sWFix(letter)))); if (fixed) letter = fixed; }
      return letter;
    }
    case "sC": return claude(sC(l), input);
    case "sT": return claude(sT, input);
    case "sM": return claude(sM(l, P), input);
    case "sO": {
      const images = c.pdf_file ? await pdfToJpegs(path.join(EVALS, c.pdf_file)) : await imageToJpeg(path.join(EVALS, c.image_file));
      return gemini(sO(l), t(l, "Rozpoznej a přelož tento dopis.", "Recognize and translate.", "Распознай текст на изображении. Выведи только распознанный текст."), images);
    }
    default: throw new Error("Unknown prompt " + c.prompt);
  }
}

function missingFixture(c) {
  for (const k of ["input_file", "image_file", "pdf_file"]) if (c[k] && !fs.existsSync(path.join(EVALS, c[k]))) return c[k];
  return null;
}

// ---------- checks ----------
const parseJson = s => JSON.parse(s.replace(/```json|```/g, "").trim());
const excerpt = (s, i = 0, n = 200) => (s || "").slice(Math.max(0, i - 40), Math.max(0, i - 40) + n).replace(/\s+/g, " ").trim();
const words = s => s.toLowerCase().match(/[\p{L}\d]+/gu)?.filter(w => w.length > 3).map(w => w.slice(0, 5)) || [];
const sentences = s => (s.replace(/\n+/g, " ").match(/[^.!?…]+[.!?…]*/g) || []).filter(x => /\p{L}/u.test(x));

// Judge answers a plain yes/no question; pass = (answer === expect), decided here, not by the judge
async function judge(question, text, context, expect = true) {
  const sys = "You are a strict evaluator of AI outputs. Answer the yes/no QUESTION about the OUTPUT. Reply ONLY with JSON: {\"answer\": true|false, \"reason\": \"one short sentence\", \"quote\": \"short verbatim quote from the output supporting your answer, or empty\"}. Do not use double quotes inside the string values.";
  const ctx = context ? `CONTEXT (what the user wrote):\n<<<\n${context}\n>>>\n\n` : "";
  const raw = await claude(sys, `QUESTION:\n${question}\n\n${ctx}OUTPUT TO EVALUATE:\n<<<\n${text}\n>>>`, { model: JUDGE_MODEL, max_tokens: 400, temperature: 0 });
  let j;
  try { j = JSON.parse(raw.match(/\{[\s\S]*\}/)[0]); } catch {
    // Fallback when the judge breaks JSON (e.g. unescaped quotes in the quote field)
    const ans = raw.match(/"answer"\s*:\s*(true|false)/);
    if (!ans) throw new Error("Judge returned no JSON: " + raw.slice(0, 120));
    j = { answer: ans[1] === "true", reason: raw.match(/"reason"\s*:\s*"([^\n]*?)",?\s*\n?\s*"quote"/)?.[1] || raw.slice(0, 200) };
  }
  return { pass: j.answer === expect, reason: `judge answered ${j.answer} (expected ${expect}): ${j.reason}`, quote: j.quote };
}

function recordOf(id) {
  const p = P.find(x => x.i === id);
  return p && { id: p.i, name: p.ne, name_cs: p.n, age: p.a, profession: p.pe, interests: p.ie, sentence: p.se, description_en: p.de, description_cs: p.d };
}

async function check(ch, out, input) {
  switch (ch.type) {
    case "stream_parser": return runStreamParserTest();
    case "regex": {
      const ok = new RegExp(ch.pattern, ch.flags || "").test(out);
      return ok ? { pass: true } : { pass: false, reason: `missing /${ch.pattern}/ (${ch.why || ""})`, excerpt: excerpt(out) };
    }
    case "no_regex": {
      if (ch.on === "reasons") out = parseJson(out).picks.map(p => p.reason).join("\n");
      const m = new RegExp(ch.pattern, (ch.flags || "").replace("g", "")).exec(out);
      return !m ? { pass: true } : { pass: false, reason: `found /${ch.pattern}/: ${ch.why || ""}`, excerpt: excerpt(out, m.index) };
    }
    case "no_gendered_sender_cs": {
      // Czech forms that always reveal the sender's gender (conditional, l-participle with "jsem", gendered adjectives)
      const m = /(^|[^\p{L}])(abych|bych|rád|ráda|vděčný|vděčná|\p{L}+la? jsem|jsem \p{L}+la?)(?![\p{L}])/iu.exec(out);
      return !m ? { pass: true } : { pass: false, reason: `gendered sender form "${m[2]}"`, excerpt: excerpt(out, m.index) };
    }
    case "clean_letter": {
      // No leftover tags, separator lines, or think-aloud self-corrections in the shown letter
      const m = /<\/?letter|^\s*[-–—*_]{3,}\s*$|\(\s*(opravuji|let me|исправляюсь)|\s[–—]\s*ne,/im.exec(out);
      return !m ? { pass: true } : { pass: false, reason: `think-aloud artifact "${m[0].trim()}"`, excerpt: excerpt(out, m.index) };
    }
    case "no_dual_forms": {
      const m = DUAL_FORM_RE.exec(out);
      return !m ? { pass: true } : { pass: false, reason: `dual gender form "${m[0]}"`, excerpt: excerpt(out, m.index) };
    }
    case "max_chars": return out.length <= ch.max ? { pass: true } : { pass: false, reason: `${out.length} chars > ${ch.max}`, excerpt: excerpt(out) };
    case "max_sentences": {
      const n = sentences(out).length;
      return n <= ch.max ? { pass: true } : { pass: false, reason: `${n} sentences > ${ch.max}`, excerpt: excerpt(out) };
    }
    case "no_table": {
      const m = /^\s*\|.*\|\s*$/m.exec(out) || /^\s*#{1,6}\s/m.exec(out);
      return !m ? { pass: true } : { pass: false, reason: "contains a table or markdown heading", excerpt: excerpt(out, m.index) };
    }
    case "sentences_present": {
      const have = new Set(words(out));
      const missing = ch.sentences.filter(s => { const w = words(s); return w.filter(x => have.has(x)).length / w.length < ch.min_overlap; });
      return !missing.length ? { pass: true } : { pass: false, reason: `user sentences not kept: ${missing.map(s => '"' + s.slice(0, 50) + '..."').join("; ")}`, excerpt: excerpt(out) };
    }
    case "json": try { parseJson(out); return { pass: true }; } catch { return { pass: false, reason: "not valid JSON", excerpt: excerpt(out) }; }
    case "picks_count": {
      const n = parseJson(out).picks?.length ?? 0;
      return n === ch.equals ? { pass: true } : { pass: false, reason: `${n} picks, expected ${ch.equals}`, excerpt: excerpt(out) };
    }
    case "picks_unique": {
      const ids = parseJson(out).picks.map(p => p.id);
      return new Set(ids).size === ids.length ? { pass: true } : { pass: false, reason: "duplicate ids: " + ids.join(", ") };
    }
    case "picks_ids_in_P": {
      const bad = parseJson(out).picks.map(p => p.id).filter(id => !P.some(p => p.i === id));
      return !bad.length ? { pass: true } : { pass: false, reason: "ids not in P: " + bad.join(", ") };
    }
    case "picks_facts_from_P": {
      const picks = parseJson(out).picks.map(p => ({ reason: p.reason, record: recordOf(p.id) }));
      const q = "Each item has a recommendation REASON and the prisoner's database RECORD. Does any reason state a fact about the prisoner that is NOT supported by that prisoner's record (e.g. calling them a lawyer, or saying they worked in law, when the record only lists law as an interest)? Rephrasing is fine. Statements comparing the prisoner with the user (e.g. similar age) are not prisoner facts.";
      return judge(q, JSON.stringify(picks, null, 1), input, false);
    }
    case "judge": {
      const text = ch.on === "reasons" ? parseJson(out).picks.map(p => "- " + p.reason).join("\n") : out;
      return judge(ch.question, text, input, ch.expect ?? true);
    }
    default: return { pass: false, reason: "unknown check " + ch.type };
  }
}

async function runOnce(c, k) {
  let out = "";
  try {
    if (c.prompt !== "local") out = await produce(c);
  } catch (e) {
    return { status: "ERROR", reason: e.message };
  }
  if (c.prompt !== "local") fs.writeFileSync(path.join(RESULTS, "outputs", c.id + (k > 1 ? ".run" + k : "") + ".txt"), out);
  const fails = [];
  for (const ch of c.checks) {
    let r;
    try { r = await check(ch, out, inputOf(c)); } catch (e) { r = { pass: false, reason: `check error: ${e.message}` }; }
    if (!r.pass) fails.push({ check: ch.type, reason: r.reason, excerpt: r.excerpt || r.quote || "" });
  }
  return { status: fails.length ? "FAIL" : "PASS", fails };
}

// Flaky cases set "runs" in cases.json; the case passes only if every run passes
async function runCase(c) {
  const miss = missingFixture(c);
  if (miss) return { c, status: "SKIP", reason: `missing fixture ${miss}` };
  const n = RUNS_OVERRIDE || c.runs || 1;
  const runs = [];
  for (let k = 1; k <= n; k++) runs.push(await runOnce(c, k));
  const passed = runs.filter(r => r.status === "PASS").length;
  const status = passed === n ? "PASS" : runs.every(r => r.status === "ERROR") ? "ERROR" : "FAIL";
  const bad = runs.map((r, i) => ({ ...r, run: i + 1 })).filter(r => r.status !== "PASS");
  return { c, status, passed, n, reason: bad.find(r => r.reason)?.reason, fails: bad.flatMap(r => (r.fails || []).map(f => ({ ...f, run: r.run }))) };
}

async function pool(items, n, fn) {
  const res = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; res[k] = await fn(items[k]); } }));
  return res;
}

function report(results, ms) {
  const count = s => results.filter(r => r.status === s).length;
  const L = [];
  L.push(`# Eval report`, ``, `${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC · ${(ms / 1000).toFixed(0)} s · Claude \`${CLAUDE_MODEL}\`, Gemini \`${GEMINI_MODEL}\`, judge \`${JUDGE_MODEL}\``, ``);
  L.push(`**${count("PASS")} passed · ${count("FAIL")} failed · ${count("ERROR")} errors · ${count("SKIP")} skipped** (of ${results.length})`, ``);
  L.push(`| Case | Result |`, `|---|---|`);
  const rate = r => r.n > 1 ? ` ${r.passed}/${r.n} (${Math.round(100 * r.passed / r.n)} %)` : "";
  for (const r of results) L.push(`| ${r.c.id} | ${r.status === "PASS" ? "✅ PASS" : r.status === "SKIP" ? "⏭ SKIP" : "❌ " + r.status}${rate(r)} |`);
  const bad = results.filter(r => r.status !== "PASS");
  if (bad.length) {
    L.push(``, `## Failures`);
    for (const r of bad) {
      L.push(``, `### ${r.c.id} — ${r.status}`);
      if (r.reason) L.push(`- ${r.reason}`);
      for (const f of r.fails || []) L.push(`- ${r.n > 1 ? "run " + f.run + " · " : ""}**${f.check}**: ${f.reason}` + (f.excerpt ? `\n  > ${f.excerpt.slice(0, 200)}` : ""));
    }
  }
  L.push(``, `Raw outputs: \`evals/results/outputs/<case>.txt\``);
  return L.join("\n") + "\n";
}

// ---------- main ----------
loadEnv();
for (const k of ["ANTHROPIC_API_KEY", "GEMINI_API_KEY"]) if (!process.env[k] && !(k === "GEMINI_API_KEY" && process.argv.includes("--no-ocr"))) { console.error(`Missing ${k} in .env.local`); process.exit(2); }
fs.mkdirSync(path.join(RESULTS, "outputs"), { recursive: true });

// Args: [id-filter] [--no-ocr] [--runs N]
const args = process.argv.slice(2);
const NO_OCR = args.includes("--no-ocr");
const RUNS_OVERRIDE = args.includes("--runs") ? +args[args.indexOf("--runs") + 1] : 0;
const filter = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--runs");
const cases = JSON.parse(fs.readFileSync(path.join(EVALS, "cases.json"), "utf8")).cases
  .filter(c => (!filter || c.id.includes(filter)) && !(NO_OCR && c.prompt === "sO"));
const t0 = Date.now();
const results = await pool(cases, CONCURRENCY, async c => {
  const r = await runCase(c);
  console.log(`${r.status.padEnd(5)} ${c.id}${r.n > 1 ? ` ${r.passed}/${r.n}` : ""}${r.status === "PASS" ? "" : "  — " + (r.reason || r.fails.map(f => f.check + ": " + f.reason).join(" | "))}`);
  return r;
});
fs.writeFileSync(path.join(RESULTS, "REPORT.md"), report(results, Date.now() - t0));
const failed = results.filter(r => r.status === "FAIL" || r.status === "ERROR").length;
console.log(`\n${results.length - failed - results.filter(r => r.status === "SKIP").length}/${results.length} passed. Report: evals/results/REPORT.md`);
process.exit(failed ? 1 : 0);
