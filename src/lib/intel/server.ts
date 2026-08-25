import { createServerFn } from "@tanstack/react-start";
import { geocode, loadFlights, loadLaunches, loadQuakes, loadTle } from "@/lib/intel/upstream";

export const getFlightsFn = createServerFn({ method: "GET" })
  .validator((input?: { lat?: number; lng?: number }) => input ?? {})
  .handler(async ({ data }) => {
    return loadFlights(data.lat, data.lng);
  });

export const getQuakesFn = createServerFn({ method: "GET" }).handler(async () => {
  return loadQuakes();
});

export const getTleFn = createServerFn({ method: "GET" }).handler(async () => {
  return loadTle();
});

export const getLaunchesFn = createServerFn({ method: "GET" }).handler(async () => {
  return loadLaunches();
});

export const geocodeFn = createServerFn({ method: "GET" })
  .validator((input: { q: string }) => input)
  .handler(async ({ data }) => {
    const q = data.q.trim();
    if (q.length < 2) return [];
    return geocode(q);
  });

export const briefFn = createServerFn({ method: "POST" })
  .validator((input: { scene: string }) => input)
  .handler(async ({ data }) => {
    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) return { ok: false as const, error: "Briefing channel offline" };
    const res = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "grok-4.5",
        max_tokens: 180,
        messages: [
          {
            role: "system",
            content:
              "You are a terse geospatial intelligence briefer. Five to seven short lines. No fluff, no markdown, no emoji. Public-source OSINT only. Never claim classified access. If data may be delayed or modeled, say so.",
          },
          { role: "user", content: data.scene.slice(0, 2400) },
        ],
      }),
    });
    if (!res.ok) return { ok: false as const, error: `Brief failed (${res.status})` };
    const body = (await res.json()) as {
      choices: { message: { content: string } }[];
    };
    return { ok: true as const, text: body.choices[0]?.message.content ?? "" };
  });
