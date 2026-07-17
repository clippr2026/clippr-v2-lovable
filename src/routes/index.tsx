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

// Homepage pública. Antes vivía acá una landing distinta (self-contained,
// sin depender de components/landing-demo); se reemplazó por la landing de
// storyboard que estaba en "/landing-demo" (ver ese route, ahora un redirect
// a "/") una vez aprobada como reemplazo definitivo. Mismas 12 piezas, mismo
// orden — nada de diseño/copy/imágenes/animaciones cambió en el pase.
export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Clippr — Software para barberías que quieren crecer" },
      {
        name: "description",
        content:
          "Agenda, caja, clientes, profesionales y Asesor IA para administrar tu barbería como una empresa.",
      },
    ],
  }),
  component: LandingPage,
});

function LandingPage() {
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
