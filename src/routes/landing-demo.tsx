import { createFileRoute, redirect } from "@tanstack/react-router";

// La landing que vivía acá pasó a ser la homepage real ("/") una vez
// aprobada como reemplazo definitivo — ver src/routes/index.tsx. Este
// redirect es solo para no romper links/bookmarks viejos a esta URL.
export const Route = createFileRoute("/landing-demo")({
  beforeLoad: () => {
    throw redirect({ to: "/" });
  },
});
