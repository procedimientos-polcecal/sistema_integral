import { createClient } from "@supabase/supabase-js";
import { normalizarUrlSupabase } from "./url";

// NUNCA importar esto en código de cliente. Usa la service-role key.
export function createAdminClient() {
  return createClient(
    normalizarUrlSupabase(process.env.NEXT_PUBLIC_SUPABASE_URL),
    (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim(),
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}
