-- Causa raíz de "los adelantos no aparecen sin refrescar la página": estas
-- tablas nunca se agregaron a la publicación supabase_realtime, así que
-- ningún cliente recibe eventos de postgres_changes sobre ellas sin
-- importar qué tan bien esté escrita la suscripción del lado del cliente
-- (useProfAdvances/useProfCommissionRecords/useProfTipRecords en
-- use-professionals-data.ts, y el canal de ProfesionalesTab en
-- cash-register.tsx, ya escuchaban estas tablas desde antes). Afecta a
-- adelantos, comisiones, propinas y liquidaciones de TODOS los
-- profesionales por igual, no solo a Franco — la publicación es por
-- tabla, nunca por fila/negocio.
alter publication supabase_realtime add table professional_advances;
alter publication supabase_realtime add table commission_records;
alter publication supabase_realtime add table tip_records;
alter publication supabase_realtime add table settlement_runs;
alter publication supabase_realtime add table settlement_payments;
alter publication supabase_realtime add table professional_settlements;
alter publication supabase_realtime add table settlement_run_sales;
alter publication supabase_realtime add table settlement_commission_links;
