import { createFileRoute } from "@tanstack/react-router";
import { geocode } from "@/lib/intel/upstream";

export const Route = createFileRoute("/api/geocode")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const q = new URL(request.url).searchParams.get("q") ?? "";
        if (q.trim().length < 2) return Response.json([]);
        try {
          return Response.json(await geocode(q));
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
