import { createClient } from "@supabase/supabase-js";

// Anon/publishable key — segura para el bundle del browser.
// Sin fallback hardcodeado a propósito: cada entorno (local, Vercel Preview,
// Vercel Production) DEBE declarar explícitamente su propio proyecto de
// Supabase. Si falta alguna variable, la app no debe arrancar en silencio
// contra un proyecto por default — eso fue lo que hizo que local terminara
// pegándole a producción.
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error(
    "Faltan VITE_SUPABASE_URL y/o VITE_SUPABASE_PUBLISHABLE_KEY. " +
      "Creá un .env.local (ver .env.example) con las credenciales del proyecto " +
      "de Supabase que quieras usar. No hay fallback a producción a propósito.",
  );
}

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
  employee_id?: string | null;
};
