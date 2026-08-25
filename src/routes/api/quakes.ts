import { createFileRoute } from "@tanstack/react-router";
import { loadQuakes } from "@/lib/intel/upstream";

export const Route = createFileRoute("/api/quakes")({
  server: {
    handlers: {
      GET: async () => {
        try {
          return Response.json(await loadQuakes());
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
