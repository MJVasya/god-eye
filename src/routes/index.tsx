import { lazy, Suspense, useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { OpsHud } from "@/components/hud/OpsHud";

const GlobeScene = lazy(() => import("@/components/globe/GlobeScene"));

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setReady(true);
  }, []);

  return (
    <main className="relative h-dvh w-full overflow-hidden bg-void">
      {ready ? (
        <Suspense fallback={<div className="h-full w-full bg-void" />}>
          <GlobeScene />
        </Suspense>
      ) : (
        <div className="h-full w-full bg-void" />
      )}
      <OpsHud />
    </main>
  );
}
