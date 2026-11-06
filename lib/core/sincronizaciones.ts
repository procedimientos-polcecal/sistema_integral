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

/**
 * El dominio pelado de un valor que puede venir con esquema o sin él.
 *
 * Las dos puntas que compara `esLaCorridaCanonica` no están escritas igual y no
 * se pueden emparejar a mano: `VERCEL_PROJECT_PRODUCTION_URL` la escribe Vercel
 * **sin `https://`** y `NEXT_PUBLIC_APP_URL` la escribe una persona en el panel,
 * donde [docs/VARIABLES-VERCEL.md](../../docs/VARIABLES-VERCEL.md) pide la URL
 * completa. Que las dos formas convivan no es hipotético: el 04/11/2026
 * `NEXT_PUBLIC_APP_URL` valía `www.polcecalpolysan.app` a secas y los canales de
 * la Agenda fallaron nueve veces con «no es una URL».
 *
 * **Saca también el `www.`, y ésa es la parte que no se deduce.** El apex
 * `polcecalpolysan.app` está enganchado al mismo proyecto de Vercel —pedirlo
 * devuelve un 308 servido por Vercel hacia el `www`—, y la documentación de
 * Vercel dice que para `VERCEL_PROJECT_PRODUCTION_URL` elige **el dominio de
 * producción más corto**. O sea que del lado de Vercel puede llegar
 * `polcecalpolysan.app` mientras del otro lado llega `www.polcecalpolysan.app`.
 * No se pudo medir cuál de los dos elige —habría que leer el entorno de
 * producción, y para eso haría falta exponerlo por una ruta—, así que la
 * comparación está escrita para que **dé lo mismo**: con o sin `www`, las dos
 * puntas se normalizan al mismo texto. Comparar los dos valores crudos no rompe
 * nada y ése es el problema: el despliegue bueno se marcaría a sí mismo como no
 * canónico y la vista volvería en silencio a lo que hace hoy.
 */
function soloElDominio(valor: string | undefined): string | null {
  const texto = (valor ?? "").trim().toLowerCase();
  if (!texto) return null;
  const sinEsquema = texto.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  const dominio = sinEsquema
    .split(/[/?#]/)[0]
    .replace(/:\d+$/, "")
    .replace(/\.$/, "")
    .replace(/^www\./, "");
  return dominio || null;
}

/**
 * Si esta corrida salió del despliegue canónico —el que sirve
 * `www.polcecalpolysan.app`— o de otra copia del repo en otro proyecto de Vercel.
 *
 * **Función pura y exportada para poder probarla**, igual que
 * `entornoDeLaCorrida`: recibe el entorno en vez de leer `process.env` adentro.
 *
 * POR QUÉ NO ALCANZA CON `entorno`. La migración `20261023104622` hizo que la
 * vista `ultima_sincronizacion` **prefiera** la corrida de producción, y en su
 * encabezado dice que no se pudo determinar quién era el que llamaba de más. Ya
 * se determinó, y el desempate que eligió no desempata: es un **segundo
 * despliegue de este mismo repo en otra cuenta de Vercel** (proyecto
 * `sistemaintegral`, en `soportemantenimiento-4821s-projects`), que tiene las
 * credenciales de Supabase pero no las de Google. Medido el 05/11/2026 contra
 * producción: **53 corridas, 51 fallidas**, desde el 24/10/2026 08:21:52 —el
 * mismo segundo que la migración marcó— hasta el 05/11/2026 09:59:34. Y como es
 * un despliegue de producción de su propio proyecto, **también escribe
 * `entorno = 'production'`**: las dos filas quedan empatadas y gana la más
 * reciente, que suele ser la suya porque corre media hora después.
 *
 * POR QUÉ NO SIRVE `host`. Es `VERCEL_URL`, que cambia con cada despliegue: en
 * las últimas 1000 filas el canónico dejó **31 hosts distintos** y el ajeno 11.
 * No hay ningún valor fijo contra el cual compararlo.
 *
 * QUÉ SÍ DISTINGUE. `VERCEL_PROJECT_PRODUCTION_URL` la define Vercel **por
 * proyecto** y es el dominio de producción de ese proyecto; en el canónico es el
 * dominio de verdad y en una copia que heredó las variables de entorno es su
 * propio `sistemaintegral-….vercel.app`. `NEXT_PUBLIC_APP_URL`, en cambio, viaja
 * copiada con el resto de las variables. Que **coincidan** es lo que una copia no
 * puede fingir sin apropiarse del dominio, que es un acto visible y del lado del
 * dueño. Las dos están disponibles en el runtime de Node de Vercel detrás del
 * mismo interruptor de variables de sistema que `VERCEL_ENV`, y ése está
 * prendido en los dos proyectos: se sabe porque las 53 filas del ajeno y las del
 * canónico traen `entorno` escrito.
 *
 * **Devuelve `false` y nunca null.** Es la misma distinción que hace
 * `entornoDeLaCorrida` al decir `local` en vez de null: `false` es «este
 * despliegue conoce la columna y dice que no es el canónico», y null en la base
 * queda reservado para **la fila que escribió un despliegue que no conoce la
 * columna**, que es la señal que se quiere poder leer. Fuera de Vercel no hay
 * `VERCEL_PROJECT_PRODUCTION_URL`, así que un script corrido a mano da `false`,
 * que es lo correcto: no es el despliegue canónico.
 *
 * Y si faltara `NEXT_PUBLIC_APP_URL` en producción, el canónico se marcaría
 * `false` y la vista quedaría desempatando como hoy. Es a propósito: este dato
 * **prefiere**, no filtra, así que equivocarse deja la pantalla como estaba y
 * nunca peor.
 */
export function esLaCorridaCanonica(env: Record<string, string | undefined>): boolean {
  const laDeVercel = soloElDominio(env.VERCEL_PROJECT_PRODUCTION_URL);
  const laQueSeCopia = soloElDominio(env.NEXT_PUBLIC_APP_URL);
  if (!laDeVercel || !laQueSeCopia) return false;
  return laDeVercel === laQueSeCopia;
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
    const canonico = esLaCorridaCanonica(process.env);

    // EL ORDEN ENTRE EL DESPLIEGUE Y LA MIGRACIÓN NO TIENE QUE IMPORTAR.
    //
    // Las migraciones las corre una persona a mano, así que este código puede
    // estar arriba antes de que existan las columnas. Y `insert` **no lanza**:
    // devuelve el error. Sin este reintento, el `catch` no se enteraría y la
    // consecuencia sería que **deja de registrarse toda sincronización, en
    // silencio** — que es peor que el problema que esto viene a arreglar.
    //
    // De la fila más informativa a la más pobre. Cada escalón saca las columnas
    // que podría no conocer una base donde todavía no corrió su migración, y el
    // último es la fila que existe desde la 037. Bajar un escalón cuesta una
    // llamada de más y sólo pasa mientras la migración está sin aplicar.
    const intentos = [
      { ...comun, entorno, host, canonico },
      { ...comun, entorno, host },
      comun,
    ];

    for (const [i, fila] of intentos.entries()) {
      const { error } = await cliente.from("sincronizaciones").insert(fila);
      if (!error) return;
      if (i === intentos.length - 1) {
        console.error("No se pudo registrar la sincronización:", error.message);
        return;
      }
      console.error(
        "No se pudo registrar la sincronización completa, se reintenta con menos columnas:",
        error.message
      );
    }
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
