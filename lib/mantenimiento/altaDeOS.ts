/**
 * Dar de alta una orden de servicio en la planilla del formulario de OS.
 *
 * Es el gemelo de `altaEnLaPlanilla()` de `formulario.ts` (las OT), con tres
 * diferencias: la variable de entorno, el nombre de la pestaña del formulario
 * —que lleva ` 1`— y que la fila se arma con `celdasDelAltaDeOS`, que no
 * depende de un encabezado sino de las columnas medidas contra la planilla.
 *
 * Toda la lógica que decide (el número que sigue, la columna del equipo, qué
 * se niega) vive en `formularioDeOS.ts` y se prueba sin red. Esto sólo habla
 * con Google y se asegura de no escribir si algo no cierra.
 */

import { errorDeCalculo, escribirCeldas, estaCalculando, leerFormulas } from "@/lib/core/sheets";
import { laFilaEstaLibre, maximoDeLaSerie } from "@/lib/mantenimiento/formulario";
import {
  celdasDelAltaDeOS, HOJA_DE_ALTAS_OS, HOJA_DE_RESPUESTAS_OS,
  loQueSigueEnLaSerieDeOS, type DatosDelAltaDeOS,
} from "@/lib/mantenimiento/formularioDeOS";

const PLANILLA = () => process.env.GOOGLE_SHEETS_OS_FORMULARIO_ID ?? "";

const COLUMNA_SERIE = "A";

/**
 * La columna de la serie, **sin calcular**: con `FORMULA` una celda vuelve como
 * el literal o como el texto de su fórmula, y la guarda de la serie necesita
 * saber cuál de las dos es. Con los valores calculados una fórmula que da 2785
 * se lee igual que un 2785 escrito.
 */
const serieDeLaPestana = async (planilla: string, pestana: string): Promise<string[][]> => {
  const filas = await leerFormulas(planilla, `${pestana}!${COLUMNA_SERIE}:${COLUMNA_SERIE}`);
  // Una planilla que está calculando devuelve vacías las celdas que no
  // resolvieron, y eso es indistinguible de una hoja sin datos: así una OT cayó
  // encima de la 623 el 13/10/2026. Si se nota, no se lee ni se escribe.
  if (estaCalculando(filas)) throw errorDeCalculo(pestana);
  return filas;
};

/**
 * El número más alto de la serie de OS, sobre las **dos** pestañas donde vive.
 * `null` si no se puede leer: «la serie va por 2785» no es lo mismo que «no sé
 * por dónde va», y un 0 confundiría las dos cosas.
 */
export async function maximoDeLaSerieDeOSEnLaPlanilla(): Promise<number | null> {
  const planilla = PLANILLA();
  if (!planilla) return null;

  try {
    const [form, altas] = await Promise.all([
      serieDeLaPestana(planilla, HOJA_DE_RESPUESTAS_OS),
      serieDeLaPestana(planilla, HOJA_DE_ALTAS_OS),
    ]);
    return Math.max(maximoDeLaSerie(form), maximoDeLaSerie(altas));
  } catch {
    return null;
  }
}

/**
 * Da de alta la OS en «Altas del sistema» y devuelve el número que le tocó.
 *
 * Se llama **antes** de crear la OS en la base: la planilla manda, y una orden
 * existe cuando tiene su fila. Si esto falla no se creó nada ni se consumió un
 * número. No lanza: devuelve qué pasó, sin traducir, para que la pantalla lo
 * muestre.
 */
export async function altaDeOSEnLaPlanilla(
  datos: DatosDelAltaDeOS
): Promise<{ ok: true; os_number: number; fila: number } | { ok: false; error: string }> {
  const planilla = PLANILLA();
  if (!planilla) {
    return {
      ok: false,
      error:
        "Falta configurar GOOGLE_SHEETS_OS_FORMULARIO_ID, así que no hay dónde " +
        "escribir la orden de servicio ni de dónde sacarle el número.",
    };
  }

  try {
    const [form, altas] = await Promise.all([
      serieDeLaPestana(planilla, HOJA_DE_RESPUESTAS_OS),
      serieDeLaPestana(planilla, HOJA_DE_ALTAS_OS),
    ]);

    // Incluye la guarda: si la columna A del formulario sigue numerando con una
    // fórmula, este error llega a la pantalla tal cual.
    const sigue = loQueSigueEnLaSerieDeOS(form, altas);
    if (!sigue.ok) return sigue;

    const armado = celdasDelAltaDeOS(datos, sigue.os_number);
    if (!armado.ok) return armado;

    // Releer justo esa celda: entre la lectura de arriba y acá puede haber
    // entrado otra alta que calculó la misma fila, y la segunda pisaría a la
    // primera sin dejar rastro.
    const destino = await leerFormulas(
      planilla, `${HOJA_DE_ALTAS_OS}!${COLUMNA_SERIE}${sigue.fila}`
    );
    if (!laFilaEstaLibre(destino)) {
      return {
        ok: false,
        error:
          `La fila ${sigue.fila} de «${HOJA_DE_ALTAS_OS}» se ocupó mientras se preparaba ` +
          `el alta. No se escribió nada: volvé a intentar.`,
      };
    }

    await escribirCeldas(
      planilla,
      armado.celdas.map((c) => ({
        pestana: HOJA_DE_ALTAS_OS,
        columna: c.columna,
        fila: sigue.fila,
        valor: c.valor,
      }))
    );

    // Releer lo escrito: es lo único que distingue «quedó con su número» de
    // «quedó con el de otro».
    const quedo = await leerFormulas(
      planilla, `${HOJA_DE_ALTAS_OS}!${COLUMNA_SERIE}${sigue.fila}`
    );
    const escrito = Number(String(quedo[0]?.[0] ?? "").trim());
    if (escrito !== sigue.os_number) {
      return {
        ok: false,
        error:
          `Se escribió la fila ${sigue.fila} de «${HOJA_DE_ALTAS_OS}» pero quedó con el N° ` +
          `${JSON.stringify(quedo[0]?.[0] ?? "")} en vez de ${sigue.os_number}. ` +
          `Revisá esa fila antes de volver a cargarla.`,
      };
    }

    return { ok: true, os_number: sigue.os_number, fila: sigue.fila };
  } catch (e) {
    const porque = e instanceof Error ? e.message : String(e);
    // Con el nombre de la pestaña adelante: el 400 por una pestaña inexistente
    // dice «Unable to parse range», que no sirve si no se sabe qué se pidió.
    return { ok: false, error: `No se pudo escribir en «${HOJA_DE_ALTAS_OS}»: ${porque}` };
  }
}
