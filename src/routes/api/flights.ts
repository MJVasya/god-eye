import { createFileRoute } from "@tanstack/react-router";
import { loadFlights } from "@/lib/intel/upstream";

export const Route = createFileRoute("/api/flights")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const url = new URL(request.url);
          const lat = Number(url.searchParams.get("lat"));
          const lng = Number(url.searchParams.get("lng"));
          return Response.json(
            await loadFlights(
              Number.isFinite(lat) ? lat : undefined,
              Number.isFinite(lng) ? lng : undefined,
            ),
          );
        } catch (err) {
          return Response.json(
            { error: err instanceof Error ? err.message : "fail" },
            { status: 502 },
          );
        }
      },
    },
  },
});
