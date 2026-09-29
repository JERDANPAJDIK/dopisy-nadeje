// Regression test for the SSE parser in ai() (src/App.jsx).
// Runs the real ai() source against a mocked stream split into random 1-7 byte chunks
// (splits "data:" lines and multi-byte UTF-8 characters). Needs no API key.
// Standalone: node evals/stream-parser.mjs
import fs from "fs";
import { fileURLToPath } from "url";

const APP = new URL("../src/App.jsx", import.meta.url);

export async function runStreamParserTest(runs = 200) {
  const src = fs.readFileSync(APP, "utf8");
  const code = src.match(/async function ai\([\s\S]*?\n\}/)?.[0];
  if (!code) return { pass: false, reason: "ai() not found in src/App.jsx" };

  const text = '{"picks":[{"id":"aleksei-gorinov","reason":"Zastupitel, 7 let."}]} Příliš žluťoučký kůň — Юрий Дмитриев, 9 000.';
  const sse = text.match(/.{1,3}/gs).map(t =>
    `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: t } })}\n\n`
  ).join("") + 'event: message_stop\ndata: {"type":"message_stop"}\n\n';
  const bytes = new TextEncoder().encode(sse);

  const realFetch = globalThis.fetch;
  let pass = 0, sample = "";
  try {
    for (let k = 0; k < runs; k++) {
      const chunks = [];
      for (let i = 0; i < bytes.length;) { const n = 1 + Math.floor(Math.random() * 7); chunks.push(bytes.slice(i, i + n)); i += n; }
      globalThis.fetch = async () => ({ ok: true, body: { getReader: () => { let i = 0; return { read: async () => i < chunks.length ? { done: false, value: chunks[i++] } : { done: true } }; } } });
      const ai = new Function(code + ";return ai;")();
      const out = await ai("key", "sys", "msg");
      if (out === text) pass++; else if (!sample) sample = out.slice(0, 120);
    }
  } finally {
    globalThis.fetch = realFetch;
  }
  return pass === runs
    ? { pass: true, reason: `exact text in ${pass}/${runs} runs` }
    : { pass: false, reason: `exact text only in ${pass}/${runs} runs`, excerpt: sample };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const r = await runStreamParserTest();
  console.log((r.pass ? "PASS" : "FAIL") + " stream-parser: " + r.reason + (r.excerpt ? "\n  got: " + r.excerpt : ""));
  process.exit(r.pass ? 0 : 1);
}
