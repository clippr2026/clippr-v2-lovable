import { AppShell } from "@/components/app-shell";
import { Topbar } from "@/components/topbar";

export function SectionPlaceholder({
  title,
  subtitle,
  blurb,
}: {
  title: string;
  subtitle?: string;
  blurb: string;
}) {
  return (
    <AppShell>
      <Topbar title={title} subtitle={subtitle} />
      <div className="glass rounded-2xl p-10 md:p-16 text-center relative overflow-hidden animate-fade-up">
        <div className="absolute inset-0 bg-[var(--gradient-glow)] pointer-events-none" />
        <div className="relative max-w-lg mx-auto">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full glass text-[11px] uppercase tracking-wider text-muted-foreground mb-5">
            <span className="h-1.5 w-1.5 rounded-full bg-accent pulse-dot" /> Coming soon
          </div>
          <h2 className="font-display text-2xl md:text-3xl font-semibold tracking-tight mb-3">
            <span className="text-gradient">{title}</span> module
          </h2>
          <p className="text-sm text-muted-foreground leading-relaxed">{blurb}</p>
          <button className="mt-7 h-10 px-5 rounded-xl bg-gradient-primary text-primary-foreground text-sm font-medium glow-blue hover:scale-[1.02] transition-transform">
            Request early access
          </button>
        </div>
      </div>
    </AppShell>
  );
}
