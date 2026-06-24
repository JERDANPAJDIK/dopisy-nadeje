export default async (req, context) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" } });
  }

  const anthropicKey = Netlify.env.get("ANTHROPIC_API_KEY");
  const geminiKey = Netlify.env.get("GEMINI_KEY");

  let body;
  try { body = await req.json(); } catch (e) {
    return sseText("⚠ Bad JSON body");
  }

  const { system, messages } = body;
  const hasImage = messages?.some(m => Array.isArray(m.content) && m.content.some(c => c.type === "image"));

  if (hasImage && geminiKey) {
    const parts = [];
    if (system) parts.push({ text: system });
    let imgChars = 0;
    for (const msg of messages) {
      if (Array.isArray(msg.content)) {
        for (const c of msg.content) {
          if (c.type === "image") {
            imgChars += (c.source.data || "").length;
            parts.push({ inline_data: { mime_type: c.source.media_type, data: c.source.data } });
          } else if (c.type === "text") {
            parts.push({ text: c.text });
          }
        }
      } else if (typeof msg.content === "string") {
        parts.push({ text: msg.content });
      }
    }

    const geminiUrl = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" + geminiKey;
    const geminiBody = JSON.stringify({ contents: [{ parts }] });

    try {
      const result = await Promise.race([
        (async () => {
          const r = await fetch(geminiUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: geminiBody });
          if (!r.ok) { const e = await r.text(); return { error: "HTTP " + r.status + ": " + e.substring(0, 300) }; }
          const d = await r.json();
          return { text: d?.candidates?.[0]?.content?.parts?.[0]?.text || "Empty response" };
        })(),
        new Promise(resolve => setTimeout(() => resolve({ error: "TIMEOUT 15s. Image base64: " + imgChars + " chars, body: " + geminiBody.length + " chars" }), 15000))
      ]);

      if (result.error) return sseText("⚠ Gemini: " + result.error);
      return sseText(result.text);
    } catch (e) {
      return sseText("⚠ Gemini crash: " + (e.message || "unknown"));
    }
  }

  if (!anthropicKey) return sseText("⚠ Missing ANTHROPIC_API_KEY");

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": anthropicKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 4000, stream: true, system, messages }),
  });
  return new Response(resp.body, { status: resp.status, headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } });
};

function sseText(text) {
  const d = "event: content_block_delta\ndata: " + JSON.stringify({type:"content_block_delta",index:0,delta:{type:"text_delta",text}}) + "\n\nevent: message_stop\ndata: {\"type\":\"message_stop\"}\n\n";
  return new Response(d, { status: 200, headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } });
}

export const config = { path: "/api/claude" };
