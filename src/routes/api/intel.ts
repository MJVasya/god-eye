import { createFileRoute } from "@tanstack/react-router";
import { geocode, loadFlights, loadLaunches, loadQuakes, loadTle } from "@/lib/intel/upstream";

export const Route = createFileRoute("/api/intel")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const layer = url.searchParams.get("layer") ?? "flights";
        try {
          if (layer === "flights") return Response.json(await loadFlights());
          if (layer === "quakes") return Response.json(await loadQuakes());
          if (layer === "tle") return Response.json(await loadTle());
          if (layer === "launches") return Response.json(await loadLaunches());
          if (layer === "geocode") {
            const q = url.searchParams.get("q") ?? "";
            if (q.trim().length < 2) return Response.json([]);
            return Response.json(await geocode(q));
          }
          return Response.json({ error: "unknown layer" }, { status: 400 });
        } catch (err) {
          const message = err instanceof Error ? err.message : "upstream failed";
          return Response.json({ error: message }, { status: 502 });
        }
      },
    },
  },
});
