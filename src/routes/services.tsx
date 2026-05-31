import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { Topbar } from "@/components/topbar";
import { PreciosTab } from "@/components/cash-register/precios-tab";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/services")({
  head: () => ({
    meta: [
      { title: "Servicios y precios — Clippr" },
      { name: "description", content: "Catálogo de servicios, bebidas y productos." },
    ],
  }),
  component: ServicesPage,
});

function ServicesPage() {
  const { businessId } = useAuth();
  return (
    <AppShell>
      <Topbar title="Servicios y precios" subtitle="Catálogo activo del negocio" />
      <div className="animate-fade-up">
        <PreciosTab businessId={businessId} />
      </div>
    </AppShell>
  );
}

