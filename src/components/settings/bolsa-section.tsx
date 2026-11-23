import * as React from "react";
import { JobPostingsButton } from "@/components/settings/job-postings";
import { BolsaProfilesButton } from "@/components/settings/bolsa-profiles";
import { PostulacionesPanel, type JoinRequest } from "@/components/settings/join-requests";
import type { BolsaTab } from "@/components/settings/bolsa-tabs";

// Configuración → Bolsa de trabajo: Avisos (empleo y alquiler de puestos), Profesionales y Postulaciones.
export function BolsaSection({ onAccept }: { onAccept: (req: JoinRequest) => void }) {
  const [tab, setTab] = React.useState<BolsaTab>("avisos");
  const [refresh, setRefresh] = React.useState(0);
  return (
    <div className="space-y-3">
      {tab === "avisos" && <JobPostingsButton inline onSelectTab={setTab} />}
      {tab === "profesionales" && <BolsaProfilesButton inline onSelectTab={setTab} onInvited={() => setRefresh((n) => n + 1)} />}
      {tab === "postulaciones" && <PostulacionesPanel inline onSelectTab={setTab} refreshKey={refresh} onAccept={onAccept} />}
    </div>
  );
}
