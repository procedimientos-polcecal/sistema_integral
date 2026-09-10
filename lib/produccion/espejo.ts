import { leerValores, escribirCeldas } from "@/lib/core/sheets";
import {
  celdasDeResumen,
  comienzoDelBloqueDePorcentaje,
  filaDeLaFecha,
  porcentajeDeRotura,
} from "./planilla";
import type { RenglonDePapel } from "./types";

/**
 * Escribir en la planilla el día que se acaba de cargar.
 *
 * Acá manda el sistema, no la planilla: es la diferencia con Compras. Calidad
 * carga en el SdG y la planilla queda como el lugar donde miran los que no
 * entran, así que esto es una exportación de una sola dirección. La hoja
 * `Carga Diaria` y el botón de Apps Script desaparecen; `Histórico` también,
 * porque existía nada más para que el script supiera el stock del día anterior.
 *
 * **No lanza: devuelve qué pasó.** Quien lo llama anota el pendiente con lo que
 * dijo Google sin traducir, y se lo dice a quien guardó. Un fallo de escritura
 * no es un `console.warn`: eso costó una tarde entera en Compras.
 */

const PLANILLA = () => process.env.GOOGLE_SHEETS_PRODUCCION_ID ?? "";
const TAB_PRODUCCION = () => process.env.GOOGLE_SHEETS_PRODUCCION_TAB_PROD ?? "Resumen Producción";
const TAB_DESPACHO = () => process.env.GOOGLE_SHEETS_PRODUCCION_TAB_DESP ?? "Resumen Despacho";
const TAB_ROTURA = () => process.env.GOOGLE_SHEETS_PRODUCCION_TAB_ROT ?? "Resumen Rotura";

/** Los encabezados están en la fila 4 y las fechas arrancan en la 5. */
const FILA_ENCABEZADOS = 4;
const PRIMERA_FILA = 5;
const ULTIMA_FILA = 34;

/**
 * El marcador del segundo bloque de `Resumen Rotura` vive en la **fila 3**, no
 * en la de encabezados. Es una fila aparte y hay que leerla aparte: los nombres
 * de producto de la fila 4 se repiten idénticos en los dos bloques y no dicen
 * dónde empieza el segundo.
 */
const FILA_MARCADOR = 3;

export interface DiaAEspejar {
  /** "YYYY-MM-DD" */
  fecha: string;
  renglonesDePapel: RenglonDePapel[];
  produccion: Record<string, number>;
  despacho: Record<string, number>;
  rotura: Record<string, number>;
}

export interface ResultadoEspejo {
  ok: boolean;
  /** Qué dijo Google, sin traducir. Un diagnóstico que no se distingue de otro no sirve. */
  error?: string;
}

export async function espejarDia(dia: DiaAEspejar): Promise<ResultadoEspejo> {
  const planilla = PLANILLA();
  if (!planilla) {
    return { ok: false, error: "Falta configurar GOOGLE_SHEETS_PRODUCCION_ID" };
  }

  try {
    const celdas: { pestana: string; columna: number; fila: number; valor: string }[] = [];
    const problemas: string[] = [];

    // El tercer elemento es lo que va cuando el producto no está en el mapa.
    // Producción va vacío: ausente ahí significa "no se pudo calcular", y un 0
    // en la planilla sería el dato falso que este módulo vino a sacar. Despacho
    // y rotura van en cero, porque ahí ausente sí significa cero.
    for (const [pestana, valores, siFalta] of [
      [TAB_PRODUCCION(), dia.produccion, "vacio"],
      [TAB_DESPACHO(), dia.despacho, "cero"],
      [TAB_ROTURA(), dia.rotura, "cero"],
    ] as const) {
      // Todo el cuerpo de la vuelta va adentro de este try: una excepción dura
      // —la pestaña fue renombrada, el env var de su nombre tiene un typo, un
      // corte de red pasajero en `leerValores`— no puede salir del `for`, porque
      // eso saltearía `escribirCeldas` de punta a punta y tiraría las celdas ya
      // armadas de las pestañas anteriores, que estaban bien. El `try` arranca
      // antes de la primera lectura a propósito: si esa lectura falla, esta
      // pestaña no empuja ninguna celda a medio armar.
      try {
        const encabezados = (await leerValores(planilla, `${pestana}!A${FILA_ENCABEZADOS}:BZ${FILA_ENCABEZADOS}`))[0] ?? [];
        const columnaA = await leerValores(
          planilla,
          `${pestana}!A${PRIMERA_FILA}:A${ULTIMA_FILA}`,
          { sinFormato: true }
        );

        const fila = filaDeLaFecha(columnaA, dia.fecha, PRIMERA_FILA);
        // No se adivina la fila: los resúmenes llegan hasta el día 30, así que
        // cualquier 31 cae acá, y escribir "la que parece" pisa otro día. Este
        // `continue` deja afuera sólo esta pestaña: las otras dos siguen su
        // camino y se escriben si están bien (ver el comentario grande al final
        // de la función sobre por qué no se cancela todo).
        if (fila === null) {
          // "una sola fila" y no "una fila": `filaDeLaFecha` devuelve null tanto
          // cuando la fecha no está —los resúmenes llegan al día 30— como cuando
          // aparece dos veces. Los dos se arreglan mirando la planilla, y el
          // mensaje tiene que servir para los dos.
          problemas.push(`La pestaña "${pestana}" no tiene una sola fila para el ${dia.fecha}`);
          continue;
        }

        // El marcador se busca en la fila 3, que se lee aparte. Pasarle la fila de
        // encabezados no lo encontraría nunca, y el efecto sería silencioso: el
        // bloque de unidades se trataría como si ocupara toda la fila, los nombres
        // repetidos volverían a caer siempre en el primer bloque, y los
        // porcentajes no se escribirían jamás sin que nada lo diga.
        const esRotura = pestana === TAB_ROTURA();
        const fila3 = esRotura
          ? (await leerValores(planilla, `${pestana}!A${FILA_MARCADOR}:BZ${FILA_MARCADOR}`))[0] ?? []
          : [];
        const comienzoPct = esRotura ? comienzoDelBloqueDePorcentaje(fila3) : null;

        // En Rotura el marcador tiene que estar, y si no está no se adivina la
        // columna: sin él los porcentajes caerían encima de las unidades.
        if (esRotura && comienzoPct === null) {
          problemas.push(
            `La pestaña "${pestana}" no tiene el marcador "% ROTURA / PRODUCCIÓN" en la fila ${FILA_MARCADOR}`
          );
          continue;
        }

        // El bloque de unidades termina donde arranca el de porcentajes, si lo hay.
        const hasta = comienzoPct ?? encabezados.length;

        const r = celdasDeResumen(encabezados, dia.renglonesDePapel, valores, { desde: 1, hasta, siFalta });
        for (const c of r.celdas) celdas.push({ pestana, columna: c.columna, fila, valor: c.valor });
        for (const n of r.sinColumna) {
          problemas.push(`La pestaña "${pestana}" no tiene columna para "${n}"`);
        }

        // El segundo bloque de Resumen Rotura: el % de cada producto.
        if (esRotura && comienzoPct !== null) {
          const pct: Record<string, string> = {};
          for (const p of dia.renglonesDePapel) {
            pct[p.id] = porcentajeDeRotura(dia.rotura[p.id] ?? 0, dia.produccion[p.id] ?? 0);
          }
          const rp = celdasDeResumen(encabezados, dia.renglonesDePapel, pct, {
            desde: comienzoPct,
            hasta: encabezados.length,
          });
          for (const c of rp.celdas) celdas.push({ pestana, columna: c.columna, fila, valor: c.valor });
        }
      } catch (e) {
        // Una excepción acá es un fallo duro de esta pestaña sola —typo en el
        // env var de su nombre, la pestaña renombrada en la planilla, un corte
        // de red al leer— y no tiene que frenar a las otras dos. Sin este catch
        // la excepción salía del `for` derecho al de afuera, `escribirCeldas`
        // no corría nunca, y las celdas ya armadas de las pestañas anteriores
        // se descartaban con ella.
        problemas.push(
          `La pestaña "${pestana}" no se pudo leer: ${e instanceof Error ? e.message : String(e)}`
        );
      }
    }

    // Se escribe lo que se pudo armar aunque otra pestaña haya tenido un
    // problema, sea un dato que falta (fila, columna, marcador) o un fallo
    // duro de lectura como los que atrapa el try/catch de arriba. Las tres
    // pestañas son independientes entre sí —no hay una cuenta que cruce
    // producción con despacho dentro de la escritura—, así que frenar
    // Despacho porque a Producción le faltó una columna, o porque a Rotura la
    // renombraron en la planilla, sería castigar un dato bueno por uno que no
    // lo es. Y no hay riesgo de dejar la planilla "a medias para siempre": el
    // día queda `sheets_pendiente` igual que si no se hubiera escrito nada, y
    // reintentarlo vuelve a mandar las tres pestañas — la que ya estaba bien
    // se reescribe con el mismo valor, porque `escribirCeldas` sobreescribe
    // cada celda y no la suma, así que no hay más costo que la llamada de más.
    if (celdas.length > 0) await escribirCeldas(planilla, celdas);
    if (problemas.length > 0) return { ok: false, error: problemas.join("; ") };

    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
