import { createFileRoute } from "@tanstack/react-router";
import { loadTle } from "@/lib/intel/upstream";

export const Route = createFileRoute("/api/tle")({
  server: {
    handlers: {
      GET: async () => {
        try {
          return Response.json(await loadTle());
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
