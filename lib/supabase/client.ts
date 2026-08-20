import { createBrowserClient } from "@supabase/ssr";
import { normalizarUrlSupabase, claveAnonima } from "./url";

export function createClient() {
  return createBrowserClient(
    normalizarUrlSupabase(process.env.NEXT_PUBLIC_SUPABASE_URL),
    claveAnonima(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  );
}
