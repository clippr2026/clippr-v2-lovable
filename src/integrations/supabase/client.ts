import { createClient } from "@supabase/supabase-js";

// Conectado a la base existente de Clippr (misma de la app vanilla).
// Anon/publishable key — segura para el bundle del browser.
const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL || "https://pypduwtioxudgepwjvom.supabase.co";
const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB5cGR1d3Rpb3h1ZGdlcHdqdm9tIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg5MzA2MjgsImV4cCI6MjA5NDUwNjYyOH0.4PBaAhAPSnVMXHaXJj604yBlBHyf_4nlAN6AOpNl474";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    storageKey: "clippr_session", // ← mismo storageKey que app.js, mantiene sesiones activas
  },
});

export type Profile = {
  id: string;
  full_name?: string | null;
  role?: string | null;
  email?: string | null;
  business_id?: string | null;
};
