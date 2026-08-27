import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const CONTENT_SPECIALIST_SYSTEM = `You are Turbo's content specialist. Draft one truthful X post about a supplied trend.

Rules:
- Use only facts present in the trend input or in explicitly supplied voice examples.
- Do not invent agent names, account history, revenue, P&L, audience size, costs, or personal experience.
- If the input does not support a personal claim, write a useful topical observation instead.
- Keep the voice direct and specific, avoid engagement bait, and do not end with a generic question.
- Use short paragraphs and no em dash.
- For a short post, stay under 240 characters. Use a thread only when the input needs the space.`;

export async function POST(req: Request) {
  try {
    const { trendId, topic, summary } = await req.json() as { trendId: string; topic: string; summary: string };

    if (!topic) {
      return NextResponse.json({ error: "topic required" }, { status: 400 });
    }

    // Load recent top tweets as live examples (from DataStore if available)
    let topTweetsContext = "";
    try {
      const row = await prisma.dataStore.findUnique({ where: { key: "voice-examples" } });
      if (row?.data) {
        const voiceFile = typeof row.data === "string" ? row.data : JSON.stringify(row.data);
        const examples = voiceFile.match(/```\n([\s\S]*?)```/g)?.slice(0, 3).join("\n\n") || "";
        if (examples) {
          topTweetsContext = `\n\n== ACTUAL RECENT TOP TWEETS (use these as voice reference) ==\n${examples}`;
        }
      }
    } catch { /* Vercel can't read local files — skip */ }

    const userMessage = `Draft a truthful post about this trending topic:

TOPIC: ${topic}
WHAT'S HAPPENING: ${summary}

Do not add personal claims that are not present above. Prefer a concrete implication or useful observation over generic news reporting.${topTweetsContext}`;

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://your-app.vercel.app",
        "X-Title": "Hermy HQ Trend Sniper",
      },
      body: JSON.stringify({
        model: "anthropic/claude-sonnet-4-5",
        messages: [
          { role: "system", content: CONTENT_SPECIALIST_SYSTEM },
          { role: "user", content: userMessage },
        ],
        max_tokens: 600,
        temperature: 0.85,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error("OpenRouter error:", err);
      return NextResponse.json({ error: "Failed to generate draft" }, { status: 500 });
    }

    const data = await response.json() as { choices: { message: { content: string } }[] };
    const draft = data.choices?.[0]?.message?.content?.trim() || "";

    if (!draft) {
      return NextResponse.json({ error: "Empty response from model" }, { status: 500 });
    }

    // Save to drafts via Hermy HQ API
    let saved = false;
    try {
      const saveRes = await fetch("https://your-app.vercel.app/api/x-content", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-secret": process.env.INTERNAL_API_SECRET || "",
        },
        body: JSON.stringify({
          text: draft,
          category: "trend-snipe",
          title: `Trend Snipe: ${topic}`,
        }),
      });
      saved = saveRes.ok;
    } catch { /* save failed, draft still returned */ }

    return NextResponse.json({ draft, trendId, saved });

  } catch (err) {
    console.error("Snipe error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
