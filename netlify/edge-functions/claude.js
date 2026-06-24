export default async (req, context) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" } });
  }

  const anthropicKey = Netlify.env.get("ANTHROPIC_API_KEY");
  const geminiKey = Netlify.env.get("GEMINI_KEY");

  let body;
  try { body = await req.json(); } catch (e) {
    return new Response(JSON.stringify({ error: { message: "Bad JSON" } }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  const { system, messages } = body;
  const hasImage = messages?.some(m => Array.isArray(m.content) && m.content.some(c => c.type === "image"));

  if (hasImage && geminiKey) {
    try {
      const parts = [];
      if (system) parts.push({ text: system });
      let imgBytes = 0;
      for (const msg of messages) {
        if (Array.isArray(msg.content)) {
          for (const c of msg.content) {
            if (c.type === "image") {
              imgBytes += (c.source.data || "").length;
              parts.push({ inline_data: { mime_type: c.source.media_type, data: c.source.data } });
            } else if (c.type === "text") {
              parts.push({ text: c.text });
            }
          }
        } else if (typeof msg.content === "string") {
          parts.push({ text: msg.content });
        }
      }

      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), 45000);

      const resp = await fetch(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" + geminiKey,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents: [{ parts }] }),
          signal: ctrl.signal,
        }
      );
      clearTimeout(tid);

      if (!resp.ok) {
        const errText = await resp.text();
        return sseText("⚠ Gemini error (" + resp.status + "): " + errText.substring(0, 300) + "\n\nImage base64: " + imgBytes + " chars");
      }

      const data = await resp.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "⚠ Gemini returned empty response";
      return sseText(text);
    } catch (e) {
      return sseText("⚠ Gemini failed: " + e.name + ": " + (e.message || "").substring(0, 200));
    }
  }

  // TEXT → Claude
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

function sseText(text) {
  const d = "event: content_block_delta\ndata: " + JSON.stringify({type:"content_block_delta",index:0,delta:{type:"text_delta",text}}) + "\n\nevent: message_stop\ndata: {\"type\":\"message_stop\"}\n\n";
  return new Response(d, { status: 200, headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } });
}

export const config = { path: "/api/claude" };
