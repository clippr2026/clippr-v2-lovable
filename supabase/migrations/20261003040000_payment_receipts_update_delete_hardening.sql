-- payment_receipts_update/payment_receipts_delete (20261003030000) solo
-- validaban el primer segmento del path contra el business_id del
-- usuario — a diferencia de select/insert, no cruzaban que el payment_id
-- del nombre de archivo perteneciera REALMENTE a ese negocio en
-- `payments`. Mismo endurecimiento acá, por consistencia con las otras
-- dos. Idempotente (drop + create), no toca columnas ni la migración
-- anterior.
-- USING valida la fila que ya existe (el objeto antes del UPDATE);
-- WITH CHECK valida el estado resultante (el path/bucket después del
-- UPDATE) — con el mismo path determinístico de siempre (upsert, nunca
-- se renombra un objeto) en la práctica validan lo mismo, pero sin
-- WITH CHECK un UPDATE podría, en teoría, dejar la fila en un estado que
-- ya no cumple la condición sin que Postgres lo rechace.
drop policy if exists payment_receipts_update on storage.objects;
create policy payment_receipts_update on storage.objects
  for update
  using (
    bucket_id = 'payment-receipts'
    and (storage.foldername(name))[1] = (select p.business_id::text from public.profiles p where p.id = auth.uid())
    and exists (
      select 1 from public.payments pay
      where pay.id::text = split_part(storage.filename(name), '.', 1)
        and pay.business_id::text = (storage.foldername(name))[1]
    )
  )
  with check (
    bucket_id = 'payment-receipts'
    and (storage.foldername(name))[1] = (select p.business_id::text from public.profiles p where p.id = auth.uid())
    and exists (
      select 1 from public.payments pay
      where pay.id::text = split_part(storage.filename(name), '.', 1)
        and pay.business_id::text = (storage.foldername(name))[1]
    )
  );

drop policy if exists payment_receipts_delete on storage.objects;
create policy payment_receipts_delete on storage.objects
  for delete
  using (
    bucket_id = 'payment-receipts'
    and (storage.foldername(name))[1] = (select p.business_id::text from public.profiles p where p.id = auth.uid())
    and exists (
      select 1 from public.payments pay
      where pay.id::text = split_part(storage.filename(name), '.', 1)
        and pay.business_id::text = (storage.foldername(name))[1]
    )
  );
