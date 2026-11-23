import * as React from "react";
import { ExternalLink } from "lucide-react";
import { JobPostingsButton } from "@/components/settings/job-postings";
import { PostulacionesPanel, type JoinRequest } from "@/components/settings/join-requests";
import type { BolsaTab } from "@/components/settings/bolsa-tabs";

// Configuración → Bolsa de trabajo: Avisos (empleo y alquiler de puestos), Profesionales y Postulaciones.
export function BolsaSection({ onAccept }: { onAccept: (req: JoinRequest) => void }) {
  const [tab, setTab] = React.useState<BolsaTab>("avisos");
  const [refresh] = React.useState(0);
  return (
    <div className="space-y-3">
      <a
        href="/bolsa-de-trabajo"
        target="_blank"
        rel="noreferrer"
        className="flex h-12 w-full items-center justify-center gap-2 rounded-full border border-violet-400/40 bg-violet-500/15 text-base font-semibold text-violet-100"
      >
        <ExternalLink className="h-4 w-4" />
        Ver la página pública
      </a>
      {tab === "avisos" && <JobPostingsButton inline onSelectTab={setTab} />}
      {tab === "postulaciones" && <PostulacionesPanel inline onSelectTab={setTab} refreshKey={refresh} onAccept={onAccept} />}
    </div>
  );
}
