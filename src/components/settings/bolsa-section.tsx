import * as React from "react";
import { JobPostingsButton } from "@/components/settings/job-postings";
import { PostulacionesPanel, type JoinRequest } from "@/components/settings/join-requests";
import type { BolsaTab } from "@/components/settings/bolsa-tabs";

// Configuración → Bolsa de trabajo: Mis avisos (empleo y alquiler de puestos) y Recibidas (postulaciones y solicitudes).
export function BolsaSection({ onAccept }: { onAccept: (req: JoinRequest) => void }) {
  const [tab, setTab] = React.useState<BolsaTab>("avisos");
  const [refresh] = React.useState(0);
  return (
    <div className="space-y-3">
      {tab === "avisos" && <JobPostingsButton inline onSelectTab={setTab} />}
      {tab === "postulaciones" && <PostulacionesPanel inline onSelectTab={setTab} refreshKey={refresh} onAccept={onAccept} />}
    </div>
  );
}
