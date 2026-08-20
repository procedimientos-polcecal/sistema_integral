/**
 * Normaliza NEXT_PUBLIC_SUPABASE_URL.
 *
 * La librería arma sus rutas pegándole `/auth/v1/...` o `/rest/v1/...` a esta
 * base, así que la base tiene que ser el origen pelado
 * (`https://<ref>.supabase.co`) y nada más.
 *
 * El panel de Supabase muestra, en la pantalla de Data API, la URL del endpoint
 * REST terminada en `/rest/v1`. Copiar ésa es un error fácil de cometer y el
 * síntoma no ayuda nada: las llamadas de login terminan en
 * `/rest/v1/auth/v1/authorize`, que es PostgREST, y responde
 * `No API key found in request` — un mensaje que hace pensar en una clave mal
 * cargada cuando el problema es la URL.
 *
 * Se recorta eso mismo, más los espacios y la barra final, que son los otros
 * dos accidentes habituales al pegar el valor.
 */
export function normalizarUrlSupabase(valor: string | undefined): string {
  const base = (valor ?? "").trim();
  if (!base) {
    throw new Error(
      "Falta NEXT_PUBLIC_SUPABASE_URL. Va el origen del proyecto: https://<ref>.supabase.co"
    );
  }

  const limpia = base
    .replace(/\/+$/, "")
    .replace(/\/(rest|auth|storage|realtime)\/v1$/, "")
    .replace(/\/+$/, "");

  if (limpia !== base) {
    console.warn(
      `[supabase] NEXT_PUBLIC_SUPABASE_URL estaba como "${base}" y se usó "${limpia}". ` +
      "Conviene corregir la variable: va sólo el origen, sin ruta."
    );
  }

  return limpia;
}

/** Clave anónima, sin espacios de más. */
export function claveAnonima(valor: string | undefined): string {
  const clave = (valor ?? "").trim();
  if (!clave) throw new Error("Falta NEXT_PUBLIC_SUPABASE_ANON_KEY.");
  return clave;
}
