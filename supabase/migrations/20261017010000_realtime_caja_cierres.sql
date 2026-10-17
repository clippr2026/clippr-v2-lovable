-- El aviso "Caja vencida"/"Tenés N cajas pendientes de cierre" (Inicio y
-- Caja > Cierres) necesita enterarse en vivo cuando OTRO dispositivo
-- confirma o reabre un cierre — el CustomEvent que dispara
-- closeSingleDayCierre (caja-cierre.ts) es same-tab, nunca cruza
-- dispositivos. Sin esto, la suscripción postgres_changes sobre
-- caja_cierres (use-caja-summary.ts, CierresTab en cash-register.tsx)
-- nunca recibe nada, sin importar qué tan bien esté escrita: la tabla
-- directamente no estaba en la publicación.
alter publication supabase_realtime add table caja_cierres;
