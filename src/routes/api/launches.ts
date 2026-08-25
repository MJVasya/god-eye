import { createFileRoute } from "@tanstack/react-router";
import { loadLaunches } from "@/lib/intel/upstream";

export const Route = createFileRoute("/api/launches")({
  server: {
    handlers: {
      GET: async () => {
        try {
          return Response.json(await loadLaunches());
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
