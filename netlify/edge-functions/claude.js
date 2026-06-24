const rateMap = new Map();
function checkRate(ip) {
  const now = Date.now();
  for (const [k, v] of rateMap) { if (now - v.start > 3600000) rateMap.delete(k); }
  const rec = rateMap.get(ip);
  if (!rec || now - rec.start > 3600000) { rateMap.set(ip, { start: now, count: 1 }); return true; }
  if (rec.count >= 30) return false;
  rec.count++;
  return true;
}

export default async (req, context) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" } });
  }
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const ip = context.ip || req.headers.get("x-forwarded-for") || "unknown";
  if (!checkRate(ip)) return new Response(JSON.stringify({ error: { message: "Too many requests" } }), { status: 429, headers: { "Content-Type": "application/json" } });

  const anthropicKey = Netlify.env.get("ANTHROPIC_API_KEY");
  const geminiKey = Netlify.env.get("GEMINI_KEY");

  let body;
  try { body = await req.json(); } catch (e) { return sseText("Bad JSON"); }
  const { system, messages } = body;
  const hasImage = messages?.some(m => Array.isArray(m.content) && m.content.some(c => c.type === "image"));

  if (hasImage && geminiKey) {
    const parts = [];
    if (system) parts.push({ text: system + "\n\n" });
    for (const msg of messages) {
      if (Array.isArray(msg.content)) {
        for (const c of msg.content) {
          if (c.type === "image") parts.push({ inline_data: { mime_type: c.source.media_type, data: c.source.data } });
          else if (c.type === "text") parts.push({ text: c.text });
        }
      } else if (typeof msg.content === "string") parts.push({ text: msg.content });
    }

    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const enc = new TextEncoder();
    const t0 = Date.now();

    // Heartbeat: send elapsed seconds every 2s so we can see how long Gemini takes
    let alive = true;
    (async () => {
      while (alive) {
        await new Promise(r => setTimeout(r, 2000));
        if (!alive) break;
        const sec = Math.round((Date.now() - t0) / 1000);
        try { await writer.write(enc.encode(deltaSSE("[" + sec + "s] "))); } catch (_) { break; }
      }
    })();

    (async () => {
      try {
        const resp = await fetch(
          "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:streamGenerateContent?alt=sse&key=" + geminiKey,
          { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ parts }] }) }
        );
        if (!resp.ok) {
          const e = await resp.text();
          alive = false;
          await writer.write(enc.encode(deltaSSE("\nGemini error " + resp.status + ": " + e.substring(0, 200))));
        } else {
          const reader = resp.body.getReader();
          const dec = new TextDecoder();
          let buf = "";
          let first = true;
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (first) { alive = false; await writer.write(enc.encode(deltaSSE("\n\n--- Gemini first byte after " + Math.round((Date.now()-t0)/1000) + "s ---\n\n"))); first = false; }
            buf += dec.decode(value, { stream: true });
            const lines = buf.split("\n");
            buf = lines.pop();
            for (const line of lines) {
              if (!line.startsWith("data: ")) continue;
              const raw = line.slice(6).trim();
              if (!raw || raw === "[DONE]") continue;
              try { const p = JSON.parse(raw); const txt = p?.candidates?.[0]?.content?.parts?.[0]?.text; if (txt) await writer.write(enc.encode(deltaSSE(txt))); } catch (_) {}
            }
          }
        }
      } catch (e) {
        alive = false;
        await writer.write(enc.encode(deltaSSE("\nFailed: " + (e.message || ""))));
      } finally {
        alive = false;
        await writer.write(enc.encode("event: message_stop\ndata: {\"type\":\"message_stop\"}\n\n"));
        await writer.close();
      }
    })();

    return new Response(readable, { status: 200, headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } });
  }

  if (!anthropicKey) return sseText("Missing ANTHROPIC_API_KEY");
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": anthropicKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 4000, stream: true, system, messages }),
  });
  return new Response(resp.body, { status: resp.status, headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } });
};

function deltaSSE(text) {
  return "event: content_block_delta\ndata: " + JSON.stringify({type:"content_block_delta",index:0,delta:{type:"text_delta",text}}) + "\n\n";
}
function sseText(text) {
  return new Response(deltaSSE(text) + "event: message_stop\ndata: {\"type\":\"message_stop\"}\n\n", { status: 200, headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } });
}

export const config = { path: "/api/claude" };
