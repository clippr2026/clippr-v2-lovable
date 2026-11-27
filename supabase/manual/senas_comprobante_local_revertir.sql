-- Revierte 20261127130000_senas_comprobante_local.sql. No borra comprobantes ni señas.
drop function if exists public.attach_deposit_proof_v1(uuid, text, text);
