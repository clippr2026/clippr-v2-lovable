import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";

import appCss from "../styles.css?url";
import { AuthProvider } from "@/hooks/use-auth";
import { Toaster } from "@/components/ui/sonner";

function NotFoundComponent() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4">
      <div className="glass max-w-md w-full rounded-3xl p-8 text-center animate-fade-up">
        <div
          className="mx-auto h-14 w-14 rounded-2xl grid place-items-center font-display text-xl text-white"
          style={{
            background: "linear-gradient(135deg, oklch(0.7 0.22 245), oklch(0.65 0.27 305))",
            boxShadow: "0 12px 32px -8px oklch(0.65 0.27 290 / 0.55)",
          }}
        >
          404
        </div>
        <h1 className="mt-5 font-display text-2xl font-semibold tracking-tight text-foreground">
          Página no encontrada
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          La página que buscás no existe o fue movida.
        </p>
        <div className="mt-6 flex justify-center">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-xl px-4 py-2 text-sm font-medium text-white transition hover:brightness-110"
            style={{
              background: "linear-gradient(135deg, oklch(0.65 0.24 255), oklch(0.65 0.28 305))",
              boxShadow: "0 10px 26px -10px oklch(0.6 0.28 290 / 0.65)",
            }}
          >
            Volver al inicio
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4">
      <div className="glass max-w-md w-full rounded-3xl p-8 text-center animate-fade-up">
        <h1 className="font-display text-xl font-semibold tracking-tight text-foreground">
          Esta página no cargó
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Algo salió mal. Probá recargar o volvé al inicio.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-xl px-4 py-2 text-sm font-medium text-white transition hover:brightness-110"
            style={{
              background: "linear-gradient(135deg, oklch(0.65 0.24 255), oklch(0.65 0.28 305))",
            }}
          >
            Reintentar
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-xl glass glass-hover px-4 py-2 text-sm font-medium text-foreground"
          >
            Volver al inicio
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { name: "theme-color", content: "#0b0a14" },
      { title: "Clippr — Studio Suite for beauty businesses" },
      { name: "description", content: "Suite premium para barberías, salones y estudios de belleza. Reservas, clientes, inventario y reportes — todo unificado." },
      { property: "og:title", content: "Clippr — Studio Suite for beauty businesses" },
      { property: "og:description", content: "Suite premium para barberías, salones y estudios de belleza. Reservas, clientes, inventario y reportes — todo unificado." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: "Clippr — Studio Suite for beauty businesses" },
      { name: "twitter:description", content: "Suite premium para barberías, salones y estudios de belleza. Reservas, clientes, inventario y reportes — todo unificado." },
    ],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&display=swap" },
      { rel: "stylesheet", href: appCss },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
        <Outlet />
        <Toaster richColors position="top-right" />
      </AuthProvider>
    </QueryClientProvider>
  );
}
