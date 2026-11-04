import { createFileRoute } from "@tanstack/react-router";

// Versión que está sirviendo el servidor. El navegador la compara con la de su propio bundle
// (ver AppUpdateBanner) para avisar cuando hay una versión nueva. Público y sin datos sensibles.
export const Route = createFileRoute("/api/version")({
  server: {
    handlers: {
      GET: () =>
        Response.json({ build: __APP_BUILD_ID__ }, { headers: { "Cache-Control": "no-store, max-age=0" } }),
    },
  },
});
