export default async (req, context) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" } });
  }

  const anthropicKey = Netlify.env.get("ANTHROPIC_API_KEY");
  const geminiKey = Netlify.env.get("GEMINI_KEY");

  let body;
  try { body = await req.json(); } catch (e) { return sseText("⚠ Bad JSON"); }

  const { system, messages } = body;
  const hasImage = messages?.some(m => Array.isArray(m.content) && m.content.some(c => c.type === "image"));

  if (hasImage && geminiKey) {
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

    // Return stream immediately, do Gemini fetch INSIDE the stream.
    // This makes Netlify see a response right away (no timeout), while
    // Gemini gets full time to process (good OCR quality, full thinking).
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const enc = new TextEncoder();

    (async () => {
      // Send keep-alive comment immediately so the connection opens
      try { await writer.write(enc.encode(": keep-alive\n\n")); } catch (_) {}

      try {
        const geminiResp = await fetch(
          "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:streamGenerateContent?alt=sse&key=" + geminiKey,
          { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ parts }] }) }
        );

        if (!geminiResp.ok) {
          const errText = await geminiResp.text();
          await writer.write(enc.encode(deltaSSE("⚠ Gemini error (" + geminiResp.status + "): " + errText.substring(0, 300))));
        } else {
          const reader = geminiResp.body.getReader();
          const dec = new TextDecoder();
          let buf = "";
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
                if (text) await writer.write(enc.encode(deltaSSE(text)));
              } catch (_) {}
            }
          }
        }
      } catch (e) {
        await writer.write(enc.encode(deltaSSE("⚠ Gemini failed: " + (e.message || ""))));
      } finally {
        await writer.write(enc.encode("event: message_stop\ndata: {\"type\":\"message_stop\"}\n\n"));
        await writer.close();
      }
    })();

    return new Response(readable, { status: 200, headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } });
  }

  if (!anthropicKey) return sseText("⚠ Missing ANTHROPIC_API_KEY");

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
