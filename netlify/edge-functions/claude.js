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
      return await handleGemini(geminiKey, system, messages);
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

async function handleGemini(apiKey, system, messages) {
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
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts }] }),
    }
  );
  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    const errDetail = data?.error?.message || JSON.stringify(data).substring(0, 300);
    const errSse = [
      "event: content_block_delta",
      `data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":${JSON.stringify("Gemini error: " + errDetail)}}}`,
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
  const sse = [
    "event: content_block_delta",
    `data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":${JSON.stringify(text)}}}`,
    "",
    "event: message_stop",
    'data: {"type":"message_stop"}',
    "",
  ].join("\n");
  return new Response(sse, {
    status: 200,
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
  });
}

export const config = { path: "/api/claude" };
