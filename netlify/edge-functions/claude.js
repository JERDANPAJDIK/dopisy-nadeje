export default async (req, context) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: { message: "Method not allowed" } }), {
      status: 405, headers: { "Content-Type": "application/json" },
    });
  }
  const anthropicKey = Netlify.env.get("ANTHROPIC_API_KEY");
  const geminiKey = Netlify.env.get("GEMINI_KEY");
  if (!anthropicKey) {
    return new Response(JSON.stringify({ error: { message: "Missing ANTHROPIC_API_KEY" } }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
  try {
    const { system, messages } = await req.json();
    const hasImage = messages?.some(m =>
      Array.isArray(m.content) && m.content.some(c => c.type === "image")
    );
    if (hasImage && geminiKey) {
      return await handleGeminiStream(geminiKey, system, messages);
    }
    return await handleClaude(anthropicKey, system, messages);
  } catch (err) {
    return new Response(JSON.stringify({ error: { message: err.message || "Proxy error" } }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
};

async function handleClaude(apiKey, system, messages) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 4000, stream: true, system, messages }),
  });
  return new Response(response.body, {
    status: response.status,
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
  });
}

async function handleGeminiStream(apiKey, system, messages) {
  const parts = [];
  if (system) parts.push({ text: system + "\n\n" });
  for (const msg of messages) {
    if (Array.isArray(msg.content)) {
      for (const c of msg.content) {
        if (c.type === "image") {
          parts.push({ inline_data: { mime_type: c.source.media_type, data: c.source.data } });
        } else if (c.type === "text") {
          parts.push({ text: c.text });
        }
      }
    } else if (typeof msg.content === "string") {
      parts.push({ text: msg.content });
    }
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse&key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts }] }),
    }
  );

  if (!response.ok) {
    const err = await response.text();
    const errSse = [
      "event: content_block_delta",
      `data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":${JSON.stringify("Gemini error: " + err.substring(0, 300))}}}`,
      "",
      "event: message_stop",
      'data: {"type":"message_stop"}',
      "",
    ].join("\n");
    return new Response(errSse, {
      status: 200,
      headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
    });
  }

  // Transform Gemini SSE → Anthropic SSE on the fly
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const enc = new TextEncoder();

  (async () => {
    const reader = response.body.getReader();
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
              const sseChunk =
                "event: content_block_delta\n" +
                `data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":${JSON.stringify(text)}}}\n\n`;
              await writer.write(enc.encode(sseChunk));
            }
          } catch (_) {}
        }
      }
    } finally {
      const stop = "event: message_stop\ndata: {\"type\":\"message_stop\"}\n\n";
      await writer.write(enc.encode(stop));
      await writer.close();
    }
  })();

  return new Response(readable, {
    status: 200,
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
  });
}

export const config = { path: "/api/claude" };
