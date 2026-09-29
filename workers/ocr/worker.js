// Cloudflare Worker — OCR proxy pro Dopisy naděje
// Přijímá {system, messages} (Anthropic formát), volá Gemini, vrací Anthropic SSE.
// Secret: GEMINI_KEY (nastav v dashboardu, NE v kódu)

const MODEL = "gemini-3.5-flash";

// Povolené domény, ze kterých smí appka Worker volat
const ALLOWED_ORIGINS = [
  "https://dopisyveznum.netlify.app",
];

// Povolené typy vstupních souborů (obrázky + PDF)
const ALLOWED_MIME = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
];

// Rate limit: kolik requestů na jednu IP za okno
const RATE_MAX = 20;
const RATE_WINDOW_MS = 60 * 60 * 1000; // 1 hodina
const hits = new Map(); // best-effort, per-isolate

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
}

function rateLimited(ip) {
  const now = Date.now();
  const rec = hits.get(ip);
  if (!rec || now - rec.start > RATE_WINDOW_MS) {
    hits.set(ip, { start: now, count: 1 });
    return false;
  }
  rec.count++;
  return rec.count > RATE_MAX;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(origin);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: cors });
    }
    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: { message: "Method not allowed" } }), {
        status: 405, headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    // Origin check — odmítni requesty mimo povolené domény
    if (!ALLOWED_ORIGINS.includes(origin)) {
      return new Response(JSON.stringify({ error: { message: "Forbidden origin" } }), {
        status: 403, headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    // Rate limit per IP
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    if (rateLimited(ip)) {
      return new Response(JSON.stringify({ error: { message: "Rate limit exceeded. Zkuste to za hodinu." } }), {
        status: 429, headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const key = env.GEMINI_KEY;
    if (!key) {
      return new Response(JSON.stringify({ error: { message: "Missing GEMINI_KEY" } }), {
        status: 500, headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    try {
      const { system, messages } = await request.json();
      const parts = [];
      if (system) parts.push({ text: system + "\n\n" });
      for (const msg of messages || []) {
        if (Array.isArray(msg.content)) {
          for (const c of msg.content) {
            // Obrázek i PDF přicházejí jako {type, source:{media_type, data}}
            if (c.type === "image" || c.type === "document") {
              const mime = c.source?.media_type;
              if (!ALLOWED_MIME.includes(mime)) {
                return new Response(JSON.stringify({ error: { message: "Unsupported file type: " + mime } }), {
                  status: 415, headers: { ...cors, "Content-Type": "application/json" },
                });
              }
              parts.push({ inline_data: { mime_type: mime, data: c.source.data } });
            } else if (c.type === "text") {
              parts.push({ text: c.text });
            }
          }
        } else if (typeof msg.content === "string") {
          parts.push({ text: msg.content });
        }
      }

      const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:streamGenerateContent?alt=sse&key=${key}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents: [{ parts }] }),
        }
      );

      if (!resp.ok) {
        const errText = await resp.text();
        const errSse =
          "event: content_block_delta\n" +
          `data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":${JSON.stringify("Gemini error: " + errText.substring(0, 300))}}}\n\n` +
          "event: message_stop\n" +
          'data: {"type":"message_stop"}\n\n';
        return new Response(errSse, {
          status: 200,
          headers: { ...cors, "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
        });
      }

      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();
      const enc = new TextEncoder();

      (async () => {
        const reader = resp.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            const lines = buf.split("\n");
            buf = lines.pop();
            for (const line of lines) {
              if (!line.startsWith("data: ")) continue;
              const raw = line.slice(6).trim();
              if (!raw || raw === "[DONE]") continue;
              try {
                const parsed = JSON.parse(raw);
                const text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text;
                if (text) {
                  const chunk =
                    "event: content_block_delta\n" +
                    `data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":${JSON.stringify(text)}}}\n\n`;
                  await writer.write(enc.encode(chunk));
                }
              } catch (_) {}
            }
          }
        } finally {
          await writer.write(enc.encode('event: message_stop\ndata: {"type":"message_stop"}\n\n'));
          await writer.close();
        }
      })();

      return new Response(readable, {
        status: 200,
        headers: { ...cors, "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: { message: err.message || "Worker error" } }), {
        status: 500, headers: { ...cors, "Content-Type": "application/json" },
      });
    }
  },
};
