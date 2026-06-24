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

  if (hasImage) {
    // Step 1: test Gemini key with simple text (no image)
    let testResult = "unknown";
    try {
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), 10000);
      const r = await fetch(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" + geminiKey,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ parts: [{ text: "Reply with just OK" }] }] }), signal: ctrl.signal }
      );
      clearTimeout(tid);
      if (r.ok) {
        const d = await r.json();
        testResult = "KEY_OK: " + (d?.candidates?.[0]?.content?.parts?.[0]?.text || "no text").substring(0, 50);
      } else {
        const errText = await r.text();
        testResult = "KEY_FAIL (" + r.status + "): " + errText.substring(0, 200);
      }
    } catch (e) {
      testResult = "KEY_ERROR: " + (e.name || "") + " " + (e.message || "").substring(0, 100);
    }

    return sseText("Gemini test: " + testResult + "\n\nGEMINI_KEY present: " + (geminiKey ? "yes (" + geminiKey.substring(0,6) + "...)" : "NO"));
  }

  // TEXT → Claude
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
