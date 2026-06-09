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

const ALL_NAV: Array<{
  label: string;
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  permKey?: PermKey;
  badge?: string;
}> = [
  { label: "Dashboard", to: "/", icon: LayoutDashboard, permKey: "dashboard" },
  { label: "Agenda", to: "/agenda", icon: Calendar, permKey: "agenda" },
  { label: "Caja", to: "/cash-register", icon: Wallet, permKey: "caja" },
  { label: "Profesionales", to: "/professionals", icon: UserCog, permKey: "profesionales" },
  { label: "Asesor IA", to: "/advisor", icon: Brain, badge: "Nuevo" },
  { label: "Clientes", to: "/clients", icon: Users, permKey: "clientes" },
  { label: "Configuración", to: "/settings", icon: Settings },
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
    <Link to="/" className="flex items-center gap-2.5 shrink-0">
      <div
        className="h-9 w-9 rounded-xl grid place-items-center font-display text-lg text-white"
        style={{
          background: "linear-gradient(135deg, oklch(0.7 0.22 245), oklch(0.65 0.27 305))",
          boxShadow: "0 8px 24px -6px oklch(0.65 0.27 290 / 0.55)",
        }}
      >
        C
      </div>
      <div className="font-display text-lg font-semibold leading-none tracking-tight">Clippr</div>
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
              "relative flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition-all whitespace-nowrap",
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
  const displayName = profile?.full_name || profile?.email || "Usuario";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label="Cuenta"
          className="h-10 w-10 rounded-xl grid place-items-center text-sm font-semibold text-white ring-1 ring-white/10 hover:brightness-110 transition"
          style={{
            background: "linear-gradient(135deg, oklch(0.7 0.22 245), oklch(0.65 0.27 305))",
          }}
        >
          {initials}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <div className="text-sm font-medium truncate">{displayName}</div>
          {profile?.email && (
            <div className="text-xs text-muted-foreground truncate">{profile.email}</div>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/settings" className="cursor-pointer">
            <UserIcon className="h-4 w-4 mr-2" /> Configuración
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
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

export function AppSidebar() {
  const { open, setOpen } = useSidebarToggle();

  return (
    <>
      <header className="sticky top-0 z-40 w-full border-b border-white/[0.06] bg-[oklch(0.1_0.025_282)]/75 backdrop-blur-xl">
        <div className="max-w-[1600px] mx-auto h-16 px-4 sm:px-6 lg:px-10 flex items-center gap-4">
          <Brand />

          {/* Desktop nav */}
          <div className="hidden lg:flex flex-1 justify-center">
            <NavItems />
          </div>

          {/* Right cluster */}
          <div className="ml-auto flex items-center gap-2">
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
          <aside className="absolute right-0 top-0 h-full w-72 max-w-[85%] border-l border-white/[0.06] bg-[oklch(0.085_0.018_280)] p-4 animate-fade-up">
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
