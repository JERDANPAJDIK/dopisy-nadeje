// --- Rate limiting ---
const rateMap = new Map();
const RATE_LIMIT = 30;        // max requests per IP
const RATE_WINDOW = 3600000;  // per 1 hour (ms)

function checkRate(ip) {
  const now = Date.now();
  // cleanup stale entries
  for (const [k, v] of rateMap) {
    if (now - v.start > RATE_WINDOW) rateMap.delete(k);
  }
  const rec = rateMap.get(ip);
  if (!rec || now - rec.start > RATE_WINDOW) {
    rateMap.set(ip, { start: now, count: 1 });
    return { ok: true, remaining: RATE_LIMIT - 1 };
  }
  if (rec.count >= RATE_LIMIT) {
    return { ok: false, remaining: 0 };
  }
  rec.count++;
  return { ok: true, remaining: RATE_LIMIT - rec.count };
}

function errorSSE(msg) {
  const data = [
    "event: content_block_delta",
    `data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":${JSON.stringify("⚠ " + msg)}}}`,
    "",
    "event: message_stop",
    'data: {"type":"message_stop"}',
    "",
  ].join("\n");
  return new Response(data, {
    status: 200,
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
  });
}

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

  // Rate limit check
  const ip = context.ip || req.headers.get("x-forwarded-for") || "unknown";
  const rate = checkRate(ip);
  if (!rate.ok) {
    return new Response(JSON.stringify({ error: { message: "Příliš mnoho požadavků. Zkuste to za chvíli. / Too many requests. Please try again later." } }), {
      status: 429,
      headers: { "Content-Type": "application/json", "Retry-After": "300" },
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
  let imageSize = 0;
  for (const msg of messages) {
    if (Array.isArray(msg.content)) {
      for (const c of msg.content) {
        if (c.type === "image") {
          imageSize += (c.source.data || "").length;
          parts.push({ inline_data: { mime_type: c.source.media_type, data: c.source.data } });
        } else if (c.type === "text") {
          parts.push({ text: c.text });
        }
      }
    } else if (typeof msg.content === "string") {
      parts.push({ text: msg.content });
    }
  }

  // Quick key test with minimal request
  try {
    const testResp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: "Say OK" }] }] }),
        signal: AbortSignal.timeout(8000),
      }
    );
    if (!testResp.ok) {
      const errText = await testResp.text();
      return errorSSE(`Gemini key/model test failed (${testResp.status}): ${errText.substring(0, 200)}`);
    }
  } catch (e) {
    return errorSSE(`Gemini unreachable: ${e.message}. Image base64 size: ${imageSize} chars.`);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 40000);

  let response;
  try {
    response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse&key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts }] }),
        signal: controller.signal,
      }
    );
  } catch (e) {
    clearTimeout(timeout);
    const msg = e.name === "AbortError" 
      ? "Gemini API timeout (40s). Try a smaller/clearer image." 
      : "Gemini API error: " + (e.message || "connection failed");
    return errorSSE(msg);
  }
  clearTimeout(timeout);

  if (!response.ok) {
    const err = await response.text();
    return errorSSE("Gemini error: " + err.substring(0, 300));
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
