import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { Topbar } from "@/components/topbar";
import { InventarioTab } from "@/components/cash-register/inventario-tab";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/inventory")({
  head: () => ({
    meta: [
      { title: "Inventario — Clippr" },
      { name: "description", content: "Stock de productos y movimientos." },
    ],
  }),
  component: InventoryPage,
});

function InventoryPage() {
  const { businessId, profile } = useAuth();
  return (
    <AppShell>
      <Topbar title="Inventario" subtitle="Stock, ingresos y retiros" />
      <div className="animate-fade-up">
        <InventarioTab businessId={businessId} userEmail={profile?.email ?? null} />
      </div>
    </AppShell>
  );
}

