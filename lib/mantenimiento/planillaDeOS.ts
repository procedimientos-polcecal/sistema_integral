/**
 * Escribir el seguimiento de una orden de servicio en su fila de la planilla.
 *
 * Salió de `app/api/mantenimiento/ordenes-servicio/route.ts`, donde era una
 * función privada, cuando la cola de pendientes necesitó escribir por el mismo
 * camino. Vive acá por la misma razón que `planillaDeOT.ts`: que la guarda de
 * «fijate que la fila siga siendo la de esta OS» sea **una sola**. Dos copias
 * es cómo una se queda sin el arreglo de la otra.
 *
 * No se prueba con vitest —habla con Google— pero lo que decide sí: qué se
 * exporta sale de `pendienteDeLaOS.ts` y qué se puede escribir de `os.ts` y
 * `denegacion.ts`, que tienen sus tests.
 */

import { leerValores, escribirCeldas } from "@/lib/core/sheets";
import { ALIAS_OS, claveDeEncabezado, puedeEscribirse } from "@/lib/mantenimiento/os";
import { dondeSeEscribeElEstado, seguroParaElMaestro } from "@/lib/mantenimiento/denegacion";

/** La OS, con lo justo para encontrar su fila. */
export interface FilaDeOS {
  os_number: number | null;
  sheets_tab: string | null;
  sheets_row: number | null;
}

/**
 * Por qué este cambio no puede llegar a la planilla, o `null` si puede.
 *
 * **Existe para que «no se pudo» deje de parecerse a «salió bien».** Hasta el
 * 26/10/2026 `escribirEnLaFilaDeLaOS` hacía `return null` cuando faltaba el id
 * de la planilla o la fila, que es exactamente el valor con el que dice que
 * escribió. Es la misma trampa que `porQueNoLlegaALaPlanilla` le sacó a las OT
 * el 16/10, y acá pasa a importar mucho más: con una cola detrás, un `null`
 * mentiroso no es sólo un cartel que falta — **limpia el pendiente**, y la
 * orden queda sin cola que la termine y sin marca que la defienda de la
 * importación.
 *
 * Hoy no muerde: las 266 OS de producción tienen `sheets_tab` y `sheets_row`
 * (medido el 26/10/2026). Se escribe igual porque lo que lo volvería a abrir
 * —una OS creada en la app antes de su primera sincronización— es justo el
 * caso que nadie prueba.
 */
export function porQueNoLlegaLaOSALaPlanilla(
  planilla: string,
  orden: FilaDeOS
): string | null {
  if (!planilla) {
    return "El cambio quedó sólo en el sistema: falta configurar GOOGLE_SHEETS_OS_ID.";
  }
  if (!orden.sheets_tab || !orden.sheets_row) {
    return (
      `La OS ${orden.os_number} todavía no tiene fila conocida en la planilla, así que ` +
      `el cambio quedó sólo en el sistema. Sincronizá las órdenes de servicio y ` +
      `volvé a intentar.`
    );
  }
  return null;
}

/**
 * Escribe el seguimiento en la fila que la OS tiene en su pestaña. Devuelve
 * qué falló, o `null` si salió.
 *
 * Best-effort a propósito: la app ya guardó, y que Google esté caído o que la
 * planilla no esté compartida como editor no puede tirar abajo el cambio. El
 * problema se devuelve para que la ruta lo anote en `sheets_pendiente` y la
 * pantalla lo muestre — un fallo de escritura nunca es un `console.warn`.
 */
export async function escribirEnLaFilaDeLaOS(
  orden: FilaDeOS,
  campos: { clave: string; valor: string }[]
): Promise<string | null> {
  const planilla = process.env.GOOGLE_SHEETS_OS_ID ?? "";

  // Y no `return null`, que es como esto se callaba.
  const noSePuede = porQueNoLlegaLaOSALaPlanilla(planilla, orden);
  if (noSePuede) return noSePuede;

  const pestana = orden.sheets_tab as string;
  const fila = orden.sheets_row as number;

  // SERVICIOS es todo fórmula salvo dos columnas escritas a mano, y una de
  // ellas es el estado maestro: el que lee el FILTER de cada pestaña de área y
  // por lo tanto el que decide si la OS llega a su pestaña.
  //
  // Esto importa para denegar. Una OS que todavía no se aprobó vive sólo acá
  // —son 11 hoy, justo las candidatas naturales a denegarse— y antes no se le
  // escribía nada: la denegación quedaba en el sistema y la planilla seguía
  // mostrándola por aprobar. Ahora se escribe el estado, y sólo el estado: el
  // resto de la hoja es QUERY(IMPORTRANGE(...)) y escribir ahí no cambia el
  // dato, rompe la fórmula y con ella toda la pestaña.
  //
  // Y no cualquier estado: `APROBADO` es el único que el FILTER de las pestañas
  // levanta, y levantar una fila corre las de abajo mientras el seguimiento
  // escrito a mano no se corre con ellas. Aprobar sigue siendo a mano en la
  // planilla; denegar es seguro porque la OS ya estaba afuera y sigue afuera.
  //
  // `true` en el segundo argumento no es un dato: es la postura. Esta función
  // **nunca aprueba**. Aprobar exige leer la pestaña del área para saber si la
  // fila entraría en el medio, y eso pasa antes, en el PATCH, porque si no se
  // puede escribir hay que abortar el cambio entero en vez de guardarlo igual.
  // Acá, con `true`, cualquier `APROBADO` que llegue queda descartado.
  const soloElEstado = dondeSeEscribeElEstado(pestana) === "maestro";
  const escribibles = campos.filter((c) =>
    soloElEstado
      ? c.clave === "estado" && seguroParaElMaestro(c.valor, true)
      : puedeEscribirse(c.clave)
  );

  if (soloElEstado && escribibles.length === 0) {
    return "Esta OS todavía no está aprobada, así que en la planilla sólo se le puede escribir " +
           "el estado, y aprobarla desde acá correría las filas de la pestaña de su área. " +
           "Se guardó en el sistema.";
  }

  try {
    const encabezado = (await leerValores(planilla, `${pestana}!1:1`))[0] ?? [];
    const claves = encabezado.map(claveDeEncabezado);

    // Que la fila siga siendo la de esta OS. El FILTER de la pestaña corre las
    // filas cuando una orden entra o sale, y el seguimiento escrito a mano no
    // se corre con ellas: escribir a ciegas se lo daría a otra orden.
    const columnaNumero = claves.findIndex((h) =>
      ALIAS_OS.os_number.some((a) => claveDeEncabezado(a) === h)
    );
    const enLaPlanilla = (await leerValores(
      planilla, `${pestana}!A${fila}:Z${fila}`, { sinFormato: true }
    ))[0] ?? [];

    if (Number(enLaPlanilla[columnaNumero >= 0 ? columnaNumero : 0]) !== orden.os_number) {
      return `La fila ${fila} de "${pestana}" ya no es la de la OS #${orden.os_number}. ` +
             "Sincronizá las órdenes de servicio y volvé a intentar.";
    }

    const celdas = escribibles
      .map((c) => ({
        columna: claves.findIndex((h) =>
          (ALIAS_OS[c.clave] ?? []).some((a) => claveDeEncabezado(a) === h)
        ),
        valor: c.valor,
      }))
      .filter((c) => c.columna >= 0)
      .map((c) => ({ pestana, fila, columna: c.columna, valor: c.valor }));

    // Que no se encuentre ninguna columna no puede terminar en un no-op mudo.
    //
    // Cada pestaña armó su encabezado a su manera y no todas traen las mismas
    // columnas, así que saltear una que falta es lo esperado. Que falten todas
    // no: significa que el encabezado no se parece a ninguno de los alias, y
    // entonces el cambio quedó sólo en el sistema. Importa sobre todo al
    // denegar en SERVICIOS, donde la única celda que se escribe es el estado.
    if (celdas.length === 0) {
      const cuales = escribibles.map((c) => c.clave).join(", ");
      return `En "${pestana}" no se encontró la columna de ${cuales}, así que el cambio ` +
             "no se pudo escribir en la planilla. Se guardó en el sistema.";
    }

    await escribirCeldas(planilla, celdas);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}
