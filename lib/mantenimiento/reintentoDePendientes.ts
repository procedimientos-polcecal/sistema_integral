/**
 * Insistir hasta que la fila del master exista.
 *
 * ── QUÉ SE ROMPÍA, MEDIDO EL 21/10/2026 ─────────────────────────────────────
 *
 * Una OT creada en la app escribe sola las columnas que viven en la hoja de
 * respuestas —A a J y la S—, porque esa fila la escribimos nosotros. Pero **de
 * la K en adelante las columnas son literales del master**: K cierre, M estado,
 * N contratista, O horas, P/Q/R operarios. Para escribirlas hace falta que la
 * fila del master ya exista, y esa fila llega por `IMPORTRANGE` y tarda.
 *
 * El alta lo intentaba **una sola vez, 0,6 segundos después de crear la
 * orden** —cuando no puede estar— y después quedaba todo en manos de la
 * sincronización completa. Las cinco órdenes que tenían algo que exportar:
 *
 *     OT 2796  creada 16/10 13:53 → escrita 18/10 19:26    53 horas
 *     OT 2826  creada 19/10 13:36 → escrita 19/10 16:35     3 horas
 *     OT 2827  creada 19/10 13:39 → escrita 19/10 16:35     3 horas
 *     OT 2845  creada 21/10 11:44 → la O seguía vacía
 *     OT 2868  creada 21/10 13:38 → la P seguía vacía
 *
 * **Cero de cinco salieron en el momento.** Ese intento nunca sirvió para nada.
 *
 * ── Y POR QUÉ EL REINTENTO NO LLEGABA ───────────────────────────────────────
 *
 * Porque el reloj no existe. `mantenimiento-sync.yml` declara un intervalo de
 * quince minutos, pero las corridas reales son **cada 3 a 5 horas**: medido
 * sobre los doce workflows del repo, que declaran intervalos de 15, 20 y 30
 * minutos y disparan **todos a la misma hora** —10:10, 05:09, 00:25, 21:53—.
 * GitHub estrangula los schedules
 * y el intervalo declarado es ficción. El encabezado de `compras-sync.yml` ya
 * había medido demoras «de horas» el 14/09/2026; lo que faltaba era sacar la
 * conclusión de que **un paso que una persona mira no puede depender de ese
 * reloj**.
 *
 * ── LO QUE ESTO NO ES ───────────────────────────────────────────────────────
 *
 * No reemplaza a `sheets_pendiente`: la cola sigue siendo la red. Si después de
 * los cuatro minutos la fila no apareció, la orden queda anotada igual que
 * antes y la termina el drenaje o la sincronización. Un reintento que se rinde
 * **y se calla** sería peor que no tenerlo.
 */

/**
 * Cuánto esperar antes de cada intento, en milisegundos.
 *
 * Los intentos caen a los 20 s, 1, 2 y 4 minutos del alta. Creciente a
 * propósito: la fila no aparece antes por preguntar más seguido, y cada
 * pregunta es una lectura de la columna A del master.
 *
 * **El total son 240 s y el techo de la función son 300.** Si esta lista
 * creciera más allá de eso, Vercel cortaría la función a la mitad de un intento
 * y el reintento no serviría de nada — hay un test que lo fija.
 */
export const ESPERAS_DEL_REINTENTO = [20_000, 40_000, 60_000, 120_000] as const;

export interface ResultadoDelReintento {
  /** Si alguno de los intentos llegó a escribir. */
  salio: boolean;
  /** Cuántas veces se intentó. Sirve para el registro, no para decidir. */
  intentos: number;
  /** Lo que dijo el último intento fallido, o `null` si salió. */
  error: string | null;
}

/** Dormir de verdad. Se inyecta para poder probar sin esperar cuatro minutos. */
const dormirDeVerdad = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Intenta escribir, espera, y vuelve a intentar hasta que salga o se acaben las
 * esperas.
 *
 * `intentar` devuelve `null` cuando salió y el motivo cuando no — es el
 * contrato de `escribirEnLaFilaDeLaOT`, para poder pasársela tal cual.
 *
 * Una excepción se convierte en el error en vez de escaparse: esto corre dentro
 * de `after()`, donde nadie espera la promesa, así que una excepción suelta se
 * perdería en silencio y la orden quedaría con el `sheets_pendiente` del primer
 * intento — que dice algo distinto de lo que pasó.
 */
export async function reintentarHastaQueSalga({
  intentar,
  dormir = dormirDeVerdad,
  esperas = ESPERAS_DEL_REINTENTO,
}: {
  intentar: () => Promise<string | null>;
  dormir?: (ms: number) => Promise<void>;
  esperas?: readonly number[];
}): Promise<ResultadoDelReintento> {
  let intentos = 0;
  let error: string | null = null;

  for (const espera of esperas) {
    await dormir(espera);
    intentos++;
    try {
      error = await intentar();
      if (error === null) return { salio: true, intentos, error: null };
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  return { salio: false, intentos, error };
}

/**
 * Lo que de una orden en la cola hace falta para decidir si se reintenta.
 *
 * Sólo la marca del último intento: el número está para que el informe se pueda
 * leer, no para decidir.
 */
export interface PendienteDeOT {
  ot_number?: number | null;
  sheets_intentado_en: string | null;
}

/**
 * Cuánto tiene que pasar entre dos intentos de la misma orden.
 *
 * **Existe porque el drenaje se dispara cuando alguien abre Órdenes**, y esa
 * pantalla se abre todo el día. Una orden que no se va a poder escribir nunca
 * —su fila desapareció de la planilla, por ejemplo— haría una lectura de la
 * columna A del master por cada visita, para nada.
 *
 * Diez minutos deja el reintento rápido donde sirve —una orden recién creada la
 * toma el `after()` de su propia ruta, no esto— y acota el costo donde no.
 */
export const MINIMO_ENTRE_INTENTOS_MS = 10 * 60_000;

/**
 * Cuáles de la cola conviene reintentar ahora.
 *
 * Una que no se intentó nunca entra siempre: no hay de qué esperar. Y una con
 * una marca ilegible **también entra**, en vez de quedar afuera para siempre
 * por un dato que no se puede leer.
 */
export function cualesReintentar<T extends PendienteDeOT>(
  pendientes: readonly T[],
  ahora: number,
  minimoMs: number = MINIMO_ENTRE_INTENTOS_MS
): T[] {
  return pendientes.filter((p) => {
    if (!p.sheets_intentado_en) return true;
    const cuando = new Date(p.sheets_intentado_en).getTime();
    if (!Number.isFinite(cuando)) return true;
    return ahora - cuando >= minimoMs;
  });
}

/**
 * Qué decirle a quien acaba de crear la orden, o `null` si no hay nada que
 * decir.
 *
 * **Las tres pantallas que crean una OT decían tres cosas distintas**, y una
 * prometía que lo escribía «la próxima sincronización» — que en la práctica es
 * dentro de 3 a 5 horas. Vive acá para que digan lo mismo y para que el día que
 * el reintento cambie, cambie el mensaje con él.
 *
 * Cuando se está reintentando **no es un error y no se escribe como tal**: es
 * lo normal recién creada. Lo que sí es un aviso de verdad es que ya no se
 * reintente, porque ahí hace falta que alguien sincronice o mire.
 */
export function avisoDelPendiente(
  error: string | null | undefined,
  reintentando: boolean
): string | null {
  if (!error) return null;

  if (reintentando) {
    return (
      "De la columna K en adelante —el cierre, el estado, las horas y los operarios— " +
      "la planilla las recibe en unos minutos: su fila del master todavía no existe y " +
      "el sistema reintenta solo."
    );
  }

  return `El estado y las horas todavía no llegaron a la planilla (${error}).`;
}

/** Cuánto espera una misma instancia antes de volver a drenar la cola. */
export const MINIMO_ENTRE_DRENAJES_MS = 30_000;

/**
 * Si esta instancia drenó hace muy poco.
 *
 * **Abrir Órdenes dispara seis consultas al listado**: la lista y los cinco
 * contadores por estado, que salen juntas. Sin esto, cada visita encolaría seis
 * drenajes simultáneos, y como los seis leerían la misma `sheets_intentado_en`
 * —todavía vieja— el freno por orden no los pararía: serían seis lecturas de la
 * columna A del master y seis escrituras de los mismos valores.
 *
 * Es un freno **por instancia** y no global, y alcanza: lo que de verdad acota
 * el costo es `cualesReintentar`. Esto sólo evita la ráfaga de una misma visita.
 */
export function hacePocoQueSeDreno(
  ultimo: number | null,
  ahora: number,
  minimoMs: number = MINIMO_ENTRE_DRENAJES_MS
): boolean {
  if (ultimo === null) return false;
  return ahora - ultimo < minimoMs;
}
