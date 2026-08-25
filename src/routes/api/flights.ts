import { createFileRoute } from "@tanstack/react-router";
import { loadFlights } from "@/lib/intel/upstream";

export const Route = createFileRoute("/api/flights")({
  server: {
    handlers: {
      GET: async () => {
        try {
          return Response.json(await loadFlights());
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
