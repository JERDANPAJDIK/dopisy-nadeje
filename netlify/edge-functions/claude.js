// Rate limiting
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
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const ip = context.ip || req.headers.get("x-forwarded-for") || "unknown";
  if (!checkRate(ip)) {
    return new Response(JSON.stringify({ error: { message: "Too many requests" } }), { status: 429, headers: { "Content-Type": "application/json" } });
  }

  const anthropicKey = Netlify.env.get("ANTHROPIC_API_KEY");
  const geminiKey = Netlify.env.get("GEMINI_KEY");

  let body;
  try {
    body = await req.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: { message: "Invalid JSON body" } }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  const { system, messages } = body;
  const hasImage = messages?.some(m => Array.isArray(m.content) && m.content.some(c => c.type === "image"));

  // IMAGE REQUEST → Gemini (non-streaming for reliability)
  if (hasImage && geminiKey) {
    try {
      const parts = [];
      if (system) parts.push({ text: system });
      for (const msg of messages) {
        if (Array.isArray(msg.content)) {
          for (const c of msg.content) {
            if (c.type === "image") parts.push({ inline_data: { mime_type: c.source.media_type, data: c.source.data } });
            else if (c.type === "text") parts.push({ text: c.text });
          }
        } else if (typeof msg.content === "string") {
          parts.push({ text: msg.content });
        }
      }

      const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents: [{ parts }] }),
          signal: AbortSignal.timeout(45000),
        }
      );

      if (!resp.ok) {
        const errText = await resp.text();
        return sseResponse("⚠ Gemini error (" + resp.status + "): " + errText.substring(0, 200));
      }

      const data = await resp.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "No response from Gemini";
      return sseResponse(text);
    } catch (e) {
      return sseResponse("⚠ Gemini failed: " + (e.message || "unknown error"));
    }
  }

  // TEXT REQUEST → Claude (streaming)
  if (!anthropicKey) {
    return new Response(JSON.stringify({ error: { message: "Missing ANTHROPIC_API_KEY" } }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": anthropicKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 4000, stream: true, system, messages }),
    });
    return new Response(resp.body, { status: resp.status, headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: { message: e.message || "Claude error" } }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
};

// Helper: wrap text in Anthropic SSE format
function sseResponse(text) {
  const data = [
    "event: content_block_delta",
    `data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":${JSON.stringify(text)}}}`,
    "",
    "event: message_stop",
    'data: {"type":"message_stop"}',
    "",
  ].join("\n");
  return new Response(data, { status: 200, headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } });
}

export const config = { path: "/api/claude" };
