import { createFileRoute } from "@tanstack/react-router";
import { Section1 } from "@/components/landing-demo/Section1";
import { Section2 } from "@/components/landing-demo/Section2";
import { Section3 } from "@/components/landing-demo/Section3";
import { Section4 } from "@/components/landing-demo/Section4";
import { Section5 } from "@/components/landing-demo/Section5";
import { SectionRejectedClients } from "@/components/landing-demo/SectionRejectedClients";
import { Section6 } from "@/components/landing-demo/Section6";
import { SectionUpsell } from "@/components/landing-demo/SectionUpsell";
import { Section7 } from "@/components/landing-demo/Section7";
import { Section8 } from "@/components/landing-demo/Section8";
import { Section9 } from "@/components/landing-demo/Section9";
import { Section10 } from "@/components/landing-demo/Section10";

// Landing nueva en construcción, totalmente aislada de "/" — no reemplaza
// nada todavía. Las 10 secciones del storyboard, integradas con scroll
// continuo, más dos secciones agregadas después (no forman parte del
// storyboard original): SectionRejectedClients (clientes que no
// consiguieron turno — separada a propósito de la Sección 5, que solo
// habla de la agenda) justo después de la 5, y SectionUpsell
// (upselling/cross-selling automático) entre la 6 y la 7.
export const Route = createFileRoute("/landing-demo")({
  head: () => ({
    meta: [{ title: "Clippr — Landing demo" }],
  }),
  component: LandingDemoPage,
});

function LandingDemoPage() {
  return (
    <main className="min-h-screen w-full overflow-x-hidden bg-[#050308] text-white">
      <Section1 />
      <Section2 />
      <Section3 />
      <Section4 />
      <Section5 />
      <SectionRejectedClients />
      <Section6 />
      <SectionUpsell />
      <Section7 />
      <Section8 />
      <Section9 />
      <Section10 />
    </main>
  );
}
