import * as React from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Calendar,
  Users,
  Wallet,
  Settings,
  UserCog,
  Bell,
  Brain,
  Globe,
  Copy,
  Share2,
  ExternalLink,
  LogOut,
  User as UserIcon,
  Menu,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, type PermKey } from "@/hooks/use-auth";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";

const ALL_NAV: Array<{
  label: string;
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  permKey?: PermKey;
  badge?: string;
}> = [
  { label: "Dashboard", to: "/dashboard", icon: LayoutDashboard, permKey: "dashboard" },
  { label: "Agenda", to: "/agenda", icon: Calendar, permKey: "agenda" },
  { label: "Caja", to: "/cash-register", icon: Wallet, permKey: "caja" },
  { label: "Profesionales", to: "/professionals", icon: UserCog, permKey: "profesionales" },
  { label: "Asesor IA", to: "/advisor", icon: Brain, badge: "Nuevo", permKey: "asesor_ia" },
  { label: "Clientes", to: "/clients", icon: Users, permKey: "clientes" },
  { label: "Configuración", to: "/settings", icon: Settings, permKey: "configuracion" },
];

function initialsOf(name?: string | null, email?: string | null) {
  const src = (name || email || "").trim();
  if (!src) return "··";
  const parts = src.split(/[\s@._-]+/).filter(Boolean);
  return (
    ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || src.slice(0, 2).toUpperCase()
  );
}

// Kept for backwards compatibility with components that imported these.
type SidebarCtx = { open: boolean; setOpen: (v: boolean) => void };
const Ctx = React.createContext<SidebarCtx | null>(null);

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  return <Ctx.Provider value={{ open, setOpen }}>{children}</Ctx.Provider>;
}
export function useSidebarToggle() {
  const ctx = React.useContext(Ctx);
  return ctx ?? { open: false, setOpen: () => {} };
}

function Brand() {
  return (
    <Link to="/dashboard" className="flex items-center gap-2.5 shrink-0">
      <img
        src="/clippr-powered-logo.webp"
        alt="Clippr"
        loading="eager"
        decoding="async"
        className="h-8 w-8 rounded-xl object-cover ring-1 ring-white/10"
      />
      <div className="font-display text-base font-semibold leading-none tracking-tight">Clippr</div>
    </Link>
  );
}

function NavItems({ onNavigate, vertical }: { onNavigate?: () => void; vertical?: boolean }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { permissions, profile } = useAuth();
  const isOwner = !profile?.role || profile.role === "owner" || profile.role === "admin_general";
  const nav = ALL_NAV.filter((item) => {
    if (!item.permKey) return true; // Configuración always visible
    if (isOwner) return true;
    return permissions[item.permKey] === true;
  });
  return (
    <nav className={cn(vertical ? "flex flex-col gap-1" : "flex items-center gap-1")}>
      {nav.map((item) => {
        const active = pathname === item.to;
        const Icon = item.icon;
        return (
          <Link
            key={item.to}
            to={item.to}
            onClick={onNavigate}
            className={cn(
              "relative flex items-center gap-2 rounded-xl px-2.5 py-1.5 text-sm font-medium transition-all whitespace-nowrap",
              active
                ? "text-foreground bg-gradient-to-r from-primary/20 to-accent/15 ring-1 ring-primary/30 shadow-[0_4px_18px_-8px_oklch(0.7_0.25_290/0.6)]"
                : "text-muted-foreground hover:text-foreground hover:bg-white/[0.04]",
            )}
          >
            <Icon className={cn("h-4 w-4", active && "text-primary")} />
            <span>{item.label}</span>
            {item.badge && (
              <span className="ml-1 rounded-full border border-primary/30 bg-primary/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                {item.badge}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

function NotificationsButton() {
  const { businessId } = useAuth();
  const [items, setItems] = React.useState<Array<{ id: string; title: string; detail: string; read: boolean }>>([]);
  const [open, setOpen] = React.useState(false);

  const readStorageKey = React.useMemo(
    () => `clippr_read_notifications_${businessId || "global"}`,
    [businessId],
  );

  const getReadIds = React.useCallback(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(readStorageKey) || "[]") as string[]);
    } catch {
      return new Set<string>();
    }
  }, [readStorageKey]);

  const markVisibleAsRead = React.useCallback(() => {
    if (items.length === 0) return;
    const read = getReadIds();
    items.forEach((item) => read.add(item.id));
    localStorage.setItem(readStorageKey, JSON.stringify(Array.from(read).slice(-500)));
    setItems((prev) => prev.map((item) => ({ ...item, read: true })));
  }, [getReadIds, items, readStorageKey]);

  React.useEffect(() => {
    let mounted = true;

    async function loadNotifications() {
      if (!businessId) return;

      const since = new Date();
      since.setDate(since.getDate() - 14);

      const { data } = await supabase
        .from("appointments")
        .select("id,client_name,service_name,status,starts_at,created_at,created_by_role")
        .eq("business_id", businessId)
        .gte("created_at", since.toISOString())
        .order("created_at", { ascending: false })
        .limit(30);

      if (!mounted) return;

      const readIds = getReadIds();
      const next = (data ?? [])
        .filter((appt: any) => {
          const role = String(appt.created_by_role || "").toLowerCase();
          return !role || role === "cliente" || role === "client" || role === "online" || role === "public";
        })
        .map((appt: any) => {
          const isCancelled = appt.status === "cancelled";
          const when = appt.starts_at ? new Date(appt.starts_at).toLocaleString("es-AR") : "Sin fecha";
          return {
            id: appt.id,
            title: isCancelled ? "Reserva cancelada" : "Nueva reserva",
            detail: `${appt.client_name || "Cliente"} · ${appt.service_name || "Servicio"} · ${when}`,
            read: readIds.has(appt.id),
          };
        })
        .slice(0, 10);

      setItems(next);
    }

    loadNotifications();
    const timer = window.setInterval(loadNotifications, 60_000);
    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, [businessId, getReadIds]);

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen) window.setTimeout(markVisibleAsRead, 700);
      }}
    >
      <DropdownMenuTrigger asChild>
        <button
          className="hidden sm:grid h-10 w-10 place-items-center rounded-xl glass glass-hover relative"
          aria-label="Notificaciones"
        >
          <Bell className="h-4 w-4" />
          {items.some((item) => !item.read) && (
            <span className="absolute top-2 right-2 h-2 w-2 rounded-full bg-accent shadow-[0_0_10px] shadow-accent/60" />
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel>Notificaciones</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {items.length === 0 ? (
          <div className="px-3 py-6 text-sm text-muted-foreground text-center">
            Sin reservas ni cancelaciones nuevas.
          </div>
        ) : (
          items.map((item) => (
            <DropdownMenuItem
              key={item.id}
              className={cn(
                "flex flex-col items-start gap-1 py-2",
                !item.read && "bg-primary/10 text-foreground",
              )}
            >
              <span className="font-medium inline-flex items-center gap-2">
                {!item.read && <span className="h-1.5 w-1.5 rounded-full bg-accent" />}
                {item.title}
              </span>
              <span className="text-xs text-muted-foreground whitespace-normal">{item.detail}</span>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function UserMenu() {
  const { profile, signOut } = useAuth();
  const initials = initialsOf(profile?.full_name, profile?.email);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label="Cuenta"
          className="h-8 w-8 rounded-xl grid place-items-center text-sm font-semibold text-white ring-1 ring-white/10 hover:brightness-110 transition"
          style={{
            background: "linear-gradient(135deg, oklch(0.7 0.22 245), oklch(0.65 0.27 305))",
          }}
        >
          {initials}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem
          onClick={() => signOut()}
          className="cursor-pointer text-destructive focus:text-destructive"
        >
          <LogOut className="h-4 w-4 mr-2" /> Cerrar sesión
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function PublicSiteMenu() {
  const { businessId } = useAuth();
  const [slug, setSlug] = React.useState<string>("");
  const [maintenance, setMaintenance] = React.useState(false);
  const [savingMaintenance, setSavingMaintenance] = React.useState(false);

  const loadSiteState = React.useCallback(() => {
    if (!businessId) return;

    supabase
      .from("businesses")
      .select("slug")
      .eq("id", businessId)
      .maybeSingle()
      .then(({ data }) => {
        setSlug(((data?.slug as string) || "").trim());
      });

    supabase
      .from("business_settings")
      .select("schedule")
      .eq("business_id", businessId)
      .maybeSingle()
      .then(({ data }) => {
        const schedule = (data?.schedule ?? {}) as Record<string, unknown>;
        const publicStatus = (schedule._publicSiteStatus ?? {}) as Record<string, unknown>;
        setMaintenance(publicStatus.maintenance === true);
      });
  }, [businessId]);

  React.useEffect(() => {
    if (!businessId) return;
    loadSiteState();

    const onUpdated = (e: Event) => {
      const s = (e as CustomEvent).detail?.slug;
      if (typeof s === "string") setSlug(s);
      loadSiteState();
    };

    window.addEventListener("clippr:slug-updated", onUpdated);
    window.addEventListener("clippr:public-site-status-updated", loadSiteState);
    return () => {
      window.removeEventListener("clippr:slug-updated", onUpdated);
      window.removeEventListener("clippr:public-site-status-updated", loadSiteState);
    };
  }, [businessId, loadSiteState]);

  const publicUrl = slug ? `https://myclippr.com/negocio/${slug}` : "";
  const publicUrlShort = slug ? `myclippr.com/negocio/${slug}` : "Configurá la URL pública";

  async function updateMaintenance(nextMaintenance: boolean) {
    if (!businessId) return toast.error("No se encontró el negocio");

    setMaintenance(nextMaintenance);
    setSavingMaintenance(true);

    const { data: existingRow } = await supabase
      .from("business_settings")
      .select("schedule")
      .eq("business_id", businessId)
      .maybeSingle();

    const existingSchedule = (existingRow?.schedule ?? {}) as Record<string, unknown>;
    const existingStatus = (existingSchedule._publicSiteStatus ?? {}) as Record<string, unknown>;

    const { error } = await supabase.from("business_settings").upsert(
      {
        business_id: businessId,
        schedule: {
          ...existingSchedule,
          _publicSiteStatus: {
            ...existingStatus,
            maintenance: nextMaintenance,
          },
        },
      },
      { onConflict: "business_id" },
    );

    setSavingMaintenance(false);

    if (error) {
      setMaintenance(!nextMaintenance);
      return toast.error("No se pudo actualizar el sitio público");
    }

    window.dispatchEvent(
      new CustomEvent("clippr:public-site-status-updated", {
        detail: { maintenance: nextMaintenance },
      }),
    );

    toast.success(nextMaintenance ? "Sitio en mantenimiento" : "Sitio online");
  }

  async function copyLink() {
    if (!slug) return toast.error("Primero configurá la página pública");
    try {
      await navigator.clipboard.writeText(publicUrl);
      toast.success("Link copiado");
    } catch {
      toast.error("No se pudo copiar el link");
    }
  }

  function openSite() {
    if (!slug) return toast.error("Primero configurá la página pública");
    window.open(publicUrl, "_blank", "noopener,noreferrer");
  }

  async function share() {
    if (!slug) return toast.error("Primero configurá la página pública");

    const nav = navigator as Navigator & {
      share?: (data: { title?: string; url?: string }) => Promise<void>;
    };

    if (typeof nav.share === "function") {
      try {
        await nav.share({ title: "Reservá tu turno", url: publicUrl });
      } catch {
        // El usuario canceló el menú de compartir.
      }
      return;
    }

    try {
      await navigator.clipboard.writeText(publicUrl);
      toast.success("Link copiado");
    } catch {
      toast.error("No se pudo compartir el link");
    }
  }

  const actionCls =
    "inline-flex items-center justify-center gap-2 rounded-2xl bg-white/[0.05] px-4 py-2.5 text-sm font-medium text-white/90 ring-1 ring-white/10 transition hover:bg-white/[0.08] hover:text-white disabled:cursor-not-allowed disabled:opacity-45";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label="Reservas online"
          className="hidden sm:inline-flex h-9 items-center gap-2 rounded-xl bg-white/[0.04] px-3 text-sm font-medium text-white/85 ring-1 ring-white/10 transition hover:bg-white/[0.07] hover:text-white"
        >
          <span className="relative grid h-5 w-5 place-items-center">
            <Globe className="h-4.5 w-4.5" />
            <span className="absolute -bottom-1 -left-1 rounded-full border-2 border-black bg-emerald-400 px-1 py-[1px] text-[6px] font-black leading-none tracking-[-0.02em] text-white">
              WWW
            </span>
          </span>
          <span>Reservas online</span>
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="end"
        className="w-[430px] rounded-3xl border-white/10 bg-[oklch(0.10_0.025_265/0.98)] p-5 shadow-2xl shadow-black/40 backdrop-blur-xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <Globe className="h-6 w-6 shrink-0 text-white/65" />
            <div className="min-w-0">
              <div className="whitespace-nowrap text-lg font-semibold leading-tight text-white">
                Sitio Web Público
              </div>
              <div className="mt-0.5 text-xs text-white/45">
                Reservas online
              </div>
            </div>
          </div>

          <button
            type="button"
            disabled={savingMaintenance || !slug}
            onClick={() => updateMaintenance(!maintenance)}
            className={[
              "inline-flex shrink-0 items-center gap-3 rounded-full px-2 py-1 text-sm font-semibold ring-1 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-45",
              maintenance
                ? "bg-amber-500/12 text-amber-200 ring-amber-500/35"
                : "bg-emerald-500/12 text-emerald-200 ring-emerald-500/35",
            ].join(" ")}
            title={maintenance ? "Pasar sitio a online" : "Poner sitio en mantenimiento"}
          >
            <span
              className={[
                "relative h-7 w-12 rounded-full ring-1 transition",
                maintenance
                  ? "bg-amber-500/25 ring-amber-400/35"
                  : "bg-emerald-500/25 ring-emerald-400/35",
              ].join(" ")}
            >
              <span
                className={[
                  "absolute top-1 h-5 w-5 rounded-full shadow-lg transition-all",
                  maintenance
                    ? "left-1 bg-amber-300 shadow-amber-500/35"
                    : "left-6 bg-emerald-300 shadow-emerald-500/35",
                ].join(" ")}
              />
            </span>
            <span className="min-w-[104px] text-left">
              {maintenance ? "Mantenimiento" : "Online"}
            </span>
          </button>
        </div>

        <div className="mt-3 break-all text-base text-white/55">
          {publicUrlShort}
        </div>

        <div className="mt-4 rounded-2xl bg-white/[0.035] p-3 text-xs leading-relaxed text-white/50 ring-1 ring-white/10">
          {maintenance
            ? "La página pública muestra un aviso de mantenimiento y no permite reservar."
            : "La página pública está activa y permite recibir reservas."}
        </div>

        <div className="mt-5 grid grid-cols-3 gap-3">
          <button type="button" onClick={copyLink} disabled={!slug} className={actionCls}>
            <Copy className="h-5 w-5" />
            Copiar
          </button>

          <button type="button" onClick={share} disabled={!slug} className={actionCls}>
            <Share2 className="h-5 w-5" />
            Compartir
          </button>

          <button type="button" onClick={openSite} disabled={!slug} className={actionCls}>
            <ExternalLink className="h-5 w-5" />
            Abrir
          </button>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AppSidebar() {
  const { open, setOpen } = useSidebarToggle();

  return (
    <>
      <header className="sticky top-0 z-40 w-full border-b border-white/10 bg-black shadow-[0_1px_0_rgba(255,255,255,.05)]">
        <div className="max-w-[1600px] mx-auto h-12 px-4 sm:px-6 lg:px-8 flex items-center gap-3">
          <Brand />

          {/* Desktop nav */}
          <div className="hidden lg:flex flex-1 justify-center">
            <NavItems />
          </div>

          {/* Right cluster */}
          <div className="ml-auto flex items-center gap-2">
            <PublicSiteMenu />
            <UserMenu />
            <button
              onClick={() => setOpen(true)}
              className="lg:hidden h-10 w-10 grid place-items-center rounded-xl glass glass-hover"
              aria-label="Abrir menú"
            >
              <Menu className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Mobile drawer */}
      {open && (
        <div className="lg:hidden fixed inset-0 z-50">
          <button
            aria-label="Cerrar menú"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          />
          <aside className="absolute right-0 top-0 h-full w-72 max-w-[85%] border-l border-border bg-background p-4 animate-fade-up">
            <div className="flex items-center justify-between mb-6">
              <Brand />
              <button
                onClick={() => setOpen(false)}
                className="h-9 w-9 grid place-items-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-white/[0.06]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <NavItems vertical onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}
    </>
  );
}
