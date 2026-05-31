import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { Topbar } from "@/components/topbar";
import { Megaphone, Send, Users, MessageCircle, Sparkles } from "lucide-react";

export const Route = createFileRoute("/marketing")({
  head: () => ({
    meta: [
      { title: "Marketing — Clippr" },
      { name: "description", content: "Campañas, recordatorios y comunicación con clientes." },
    ],
  }),
  component: MarketingPage,
});

const channels = [
  {
    icon: MessageCircle,
    title: "WhatsApp",
    desc: "Recordatorios automáticos 24 h antes del turno.",
    status: "Próximamente",
  },
  {
    icon: Send,
    title: "Email",
    desc: "Newsletter y promociones segmentadas por cliente.",
    status: "Próximamente",
  },
  {
    icon: Users,
    title: "Reactivación",
    desc: "Detectar clientes sin visitas en los últimos 60 días.",
    status: "Próximamente",
  },
];

function MarketingPage() {
  return (
    <AppShell>
      <Topbar title="Marketing" subtitle="Llegá a tus clientes en el momento exacto" />
      <div className="animate-fade-up space-y-6">
        <div className="glass rounded-2xl p-8 md:p-10 relative overflow-hidden">
          <div className="absolute inset-0 bg-[var(--gradient-glow)] pointer-events-none" />
          <div className="relative flex items-start gap-4">
            <div
              className="h-12 w-12 rounded-xl grid place-items-center shrink-0"
              style={{
                background:
                  "linear-gradient(135deg, oklch(0.65 0.24 255), oklch(0.65 0.28 305))",
              }}
            >
              <Megaphone className="h-5 w-5 text-white" />
            </div>
            <div>
              <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full glass text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
                <Sparkles className="h-3 w-3" /> En construcción
              </div>
              <h2 className="font-display text-2xl md:text-3xl font-semibold tracking-tight">
                Convertí cada turno en{" "}
                <span className="text-gradient">una conversación</span>
              </h2>
              <p className="text-sm text-muted-foreground mt-2 max-w-xl leading-relaxed">
                El módulo de marketing va a permitir enviar recordatorios, reactivar
                clientes inactivos y medir el retorno de cada campaña sin salir de Clippr.
              </p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {channels.map((c) => {
            const Icon = c.icon;
            return (
              <div
                key={c.title}
                className="glass glass-hover rounded-2xl p-5 transition-transform hover:-translate-y-0.5"
              >
                <div className="h-10 w-10 rounded-xl bg-white/[0.04] grid place-items-center mb-3">
                  <Icon className="h-4 w-4 text-primary" />
                </div>
                <div className="text-sm font-semibold">{c.title}</div>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{c.desc}</p>
                <div className="mt-4 text-[10px] uppercase tracking-wider text-muted-foreground">
                  {c.status}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </AppShell>
  );
}
