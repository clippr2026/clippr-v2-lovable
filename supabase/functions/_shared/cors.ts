// CORS headers compartidos por las Edge Functions de Clippr.
// La página pública de reservas vive en myclippr.com y llama a estas
// funciones desde el browser, así que necesitamos habilitar CORS.
export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
