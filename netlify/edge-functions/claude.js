export default async (req, context) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" } });
  }

  const anthropicKey = Netlify.env.get("ANTHROPIC_API_KEY");

  let body;
  try {
    body = await req.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: { message: "Bad JSON" } }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  const { system, messages } = body;
  const hasImage = messages?.some(m => Array.isArray(m.content) && m.content.some(c => c.type === "image"));

  // IMAGE → just return test message, no Gemini call at all
  if (hasImage) {
    const sseData = "event: content_block_delta\ndata: " + JSON.stringify({type:"content_block_delta",index:0,delta:{type:"text_delta",text:"TEST OK - edge function works for images"}}) + "\n\nevent: message_stop\ndata: {\"type\":\"message_stop\"}\n\n";
    return new Response(sseData, { status: 200, headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } });
  }

  // TEXT → Claude streaming
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": anthropicKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 4000, stream: true, system, messages }),
  });
  return new Response(resp.body, { status: resp.status, headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } });
};

export const config = { path: "/api/claude" };
