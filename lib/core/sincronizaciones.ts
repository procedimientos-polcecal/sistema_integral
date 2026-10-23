import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Deja anotado que un recurso se sincronizó con su planilla.
 *
 * Se registra **también cuando falla**, y eso es el punto: una fecha vieja sin
 * explicación es justo lo que hace que nadie sepa si está mirando datos al día.
 * Si sólo se anotaran los éxitos, una sincronización rota se vería igual que
 * una que nunca corrió.
 *
 * Nunca lanza. Es un dato para la pantalla, no parte de la operación: que no se
 * pueda anotar no puede hacer fallar la sincronización que sí funcionó.
 */
/**
 * De qué entorno salió esta corrida.
 *
 * **Función pura y exportada para poder probarla**: es una decisión, no
 * plomería. Recibe el entorno en vez de leer `process.env` adentro.
 *
 * `local` y no null cuando no hay `VERCEL_ENV`, y la diferencia importa: null
 * es lo que deja **un despliegue que no conoce esta columna**, que es
 * justamente la señal que se quiere poder leer. Un script corrido a mano desde
 * una máquina no es eso.
 */
export function entornoDeLaCorrida(env: Record<string, string | undefined>): {
  entorno: string;
  host: string | null;
} {
  return {
    entorno: env.VERCEL_ENV || "local",
    host: env.VERCEL_URL || null,
  };
}

export async function registrarSincronizacion(datos: {
  modulo: string;
  recurso: string;
  ok: boolean;
  error?: string | null;
  filas?: number;
}): Promise<void> {
  const comun = {
    modulo: datos.modulo,
    recurso: datos.recurso,
    ok: datos.ok,
    error: datos.error ?? null,
    filas: datos.filas ?? 0,
  };

  try {
    const cliente = createAdminClient();
    const { entorno, host } = entornoDeLaCorrida(process.env);

    const { error } = await cliente
      .from("sincronizaciones")
      .insert({ ...comun, entorno, host });
    if (!error) return;

    // EL ORDEN ENTRE EL DESPLIEGUE Y LA MIGRACIÓN NO TIENE QUE IMPORTAR.
    //
    // Las migraciones las corre una persona a mano, así que este código puede
    // estar arriba antes de que existan las columnas. Y `insert` **no lanza**:
    // devuelve el error. Sin este reintento, el `catch` no se enteraría y la
    // consecuencia sería que **deja de registrarse toda sincronización, en
    // silencio** — que es peor que el problema que esto viene a arreglar.
    //
    // Se puede sacar cuando la migración 20261023104622 esté aplicada en todos
    // lados; mientras tanto cuesta una llamada de más sólo cuando falla.
    console.error(
      "No se pudo registrar la sincronización con el entorno, se reintenta sin él:",
      error.message
    );
    await cliente.from("sincronizaciones").insert(comun);
  } catch (e) {
    console.error("No se pudo registrar la sincronización:", e);
  }
}

/** La última corrida de cada recurso, como la deja la vista. */
export interface UltimaSync {
  modulo: string;
  recurso: string;
  ok: boolean;
  error: string | null;
  created_at: string;
}

/**
 * Cuándo se actualizó por última vez un recurso.
 *
 * Sale de la vista `ultima_sincronizacion`, que une la tabla de Compras con la
 * genérica: la pantalla no tiene que saber de qué módulo viene el dato ni en
 * qué tabla se guarda.
 *
 * Devuelve null si nunca corrió, y también si la consulta falla: el cartel dice
 * "sin sincronizar todavía", que es preferible a voltear la pantalla por un
 * dato accesorio.
 */
export async function ultimaSincronizacionDe(
  supabase: { from: (t: string) => any }, // eslint-disable-line @typescript-eslint/no-explicit-any
  modulo: string,
  recurso: string
): Promise<UltimaSync | null> {
  try {
    const { data } = await supabase
      .from("ultima_sincronizacion")
      .select("modulo, recurso, ok, error, created_at")
      .eq("modulo", modulo)
      .eq("recurso", recurso)
      .maybeSingle();
    return (data as UltimaSync) ?? null;
  } catch {
    return null;
  }
}
