/**
 * Lo puro del alta de una orden de servicio (OS) en la planilla del formulario.
 *
 * Es el hermano de `lib/mantenimiento/formulario.ts`, que hace lo mismo para
 * las órdenes de TRABAJO, y **reusa de él lo que es genérico** en vez de
 * reescribirlo: `laSerieEstaCongelada`, `maximoDeLaSerie` y el tipo `Celda`.
 * Todo lo que acá se decide es lo que cambia de una a otra: las pestañas, la
 * numeración y, sobre todo, **a qué columna va el equipo**.
 *
 * No habla con Google: recibe lo ya leído y devuelve qué escribir, o por qué no
 * se puede. Lo que escribe de verdad lo hace `altaDeOS.ts`.
 *
 * ── LA COLUMNA DEL EQUIPO DEPENDE DEL SECTOR ────────────────────────────────
 *
 * El formulario tiene **catorce columnas de equipo**, `G` a `T`, una por sector,
 * porque pregunta por el equipo después de elegir el sector. De cada respuesta
 * se llena exactamente una. El master las junta con `FLATTEN`, que tira las
 * vacías y no sabe de qué fila venía cada valor: si el alta pusiera el equipo
 * en cualquier columna, o en dos, desalinearía la columna EQUIPO entera —el
 * error que ya está vivo en las OS 13 y 14—. Por eso el alta **se niega** ante
 * un sector sin columna en vez de adivinar una: una fila que entra por la
 * puerta equivocada no avisa nunca, y la sigue pagando cada fila que viene
 * detrás.
 *
 * Los sectores que el sistema escribe a mano van normalizados —con y sin
 * acento, en minúscula—, igual que `pestanaDeSector` de `comparativas.ts`.
 *
 * ── LA COLUMNA Y NO SE ESCRIBE NUNCA ────────────────────────────────────────
 *
 * Dice `ESPECIFIQUE EQUIPO` en el encabezado, pero sus 229 valores son correos:
 * es a quién se le avisa. El encabezado miente y eso es de la planilla; lo que
 * le toca al sistema es no escribirla.
 */

import { serialDelDia, serialDelInstante } from "@/lib/core/fechaDeSheets";
import { filaSiguienteSegunLaColumna, textoParaLaCelda } from "@/lib/core/sheets";
import {
  laSerieEstaCongelada, maximoDeLaSerie, type Celda,
} from "@/lib/mantenimiento/formulario";
import { normalizar } from "@/lib/mantenimiento/planilla";

/** La pestaña donde caen las respuestas del formulario de OS. Lleva ` 1`. */
export const HOJA_DE_RESPUESTAS_OS = "Respuestas de formulario 1";

/** La pestaña donde el sistema escribe sus altas, y sólo él. */
export const HOJA_DE_ALTAS_OS = "Altas del sistema";

/**
 * Qué columna de equipo usa cada sector, medido contra la planilla real.
 *
 * Dos celdas del spec son ambiguas y se resolvieron así: «Hidratación» figura
 * en la `K` y en la `L` y se mandó a la `L`, que es la propia (la `K` se la
 * queda Calcinación); y «Otros» —el plural, que es como lo llama el sistema— va
 * a la `G`, mientras que «Otro» en singular va a la `T`.
 */
export const COLUMNA_DE_EQUIPO_POR_SECTOR: Record<string, string> = {
  "cantera": "G",
  "edificios": "G",
  "otros": "G",
  "planta de trituracion 1": "H",
  "planta de trituracion 2": "I",
  "planta de trituracion 3": "J",
  "calcinacion": "K",
  "hidratacion": "L",
  "molienda de cal": "M",
  "planta filler 1": "N",
  "planta filler 2": "O",
  "planta 0-2 mm": "P",
  "despacho": "Q",
  "equipos moviles": "R",
  "compresores": "S",
  "otro": "T",
  "laboratorio": "T",
};

/** La letra de una columna como índice, contando desde A = 0. */
const indiceDeLetra = (letra: string): number => letra.charCodeAt(0) - 65;

/** Las columnas literales del alta, contando desde A = 0. */
const COL = {
  numero: 0,              // A  ID SERVICIO
  marca: 1,               // B  marca temporal
  area: 4,                // E
  sector: 5,              // F
  descripcion: 20,        // U
  fechaRequerimiento: 21, // V  para cuándo
  detalleExtra: 22,       // W
} as const;

export function columnaDeEquipo(
  sector: string
): { ok: true; columna: number } | { ok: false; error: string } {
  const letra = COLUMNA_DE_EQUIPO_POR_SECTOR[normalizar(sector)];
  if (!letra) {
    return {
      ok: false,
      error:
        `El sector «${sector}» no tiene columna de equipo en «${HOJA_DE_RESPUESTAS_OS}»: ` +
        `no se escribe, porque poner el equipo en otra columna corre la columna EQUIPO ` +
        `del master de todas las filas que siguen.`,
    };
  }
  return { ok: true, columna: indiceDeLetra(letra) };
}

/** Lo que el alta necesita saber de la orden de servicio. */
export interface DatosDelAltaDeOS {
  /** Cuándo se creó. Va como serial, nunca como texto. */
  fecha: Date;
  area: string;
  sector: string;
  equipo: string;
  descripcion: string;
  /** "YYYY-MM-DD". Para cuándo se la necesita. */
  fechaRequerimiento: string | null;
  detalleExtra: string | null;
}

/**
 * Qué celdas hay que escribir para que la fila sea una OS. Sólo las que el alta
 * llena: la `Y` (correos) y lo demás quedan vacíos a propósito.
 *
 * Toda la prosa pasa por `textoParaLaCelda`: la escritura es `USER_ENTERED` y
 * una descripción que arranque con `=` se ejecutaría como fórmula. El número y
 * los seriales no, porque prefijarlos los volvería texto.
 */
export function celdasDelAltaDeOS(
  datos: DatosDelAltaDeOS,
  osNumber: number
): { ok: true; celdas: Celda[] } | { ok: false; error: string } {
  const equipo = columnaDeEquipo(datos.sector);
  if (!equipo.ok) return equipo;

  // `serialDelInstante` no valida: una fecha inválida da NaN, que escrito es
  // "NaN" y deja una marca temporal basura en una fila que ya no se distingue
  // de una respuesta de verdad.
  const marca = serialDelInstante(datos.fecha);
  if (!Number.isFinite(marca)) {
    return { ok: false, error: `La fecha de creación no es válida: ${String(datos.fecha)}.` };
  }

  // Las fechas van como serial o no van: un "01/12/2026" lo interpreta la
  // planilla según su locale, la trampa que dio vuelta 885 fechas en Compras.
  let paraCuando: number | null = null;
  if (datos.fechaRequerimiento) {
    paraCuando = serialDelDia(datos.fechaRequerimiento);
    if (paraCuando === null) {
      return { ok: false, error: `La fecha ${datos.fechaRequerimiento} no existe.` };
    }
  }

  const texto = (v: string | null | undefined): string =>
    textoParaLaCelda(String(v ?? "").trim());

  const candidatas: Celda[] = [
    { columna: COL.numero, valor: osNumber },
    { columna: COL.marca, valor: marca },
    { columna: COL.area, valor: texto(datos.area) },
    { columna: COL.sector, valor: texto(datos.sector) },
    { columna: equipo.columna, valor: texto(datos.equipo) },
    { columna: COL.descripcion, valor: texto(datos.descripcion) },
    { columna: COL.detalleExtra, valor: texto(datos.detalleExtra) },
  ];
  if (paraCuando !== null) {
    candidatas.push({ columna: COL.fechaRequerimiento, valor: paraCuando });
  }

  // Lo vacío no se escribe: una celda en blanco escrita deja de serlo para el
  // `FILTER` del master.
  return { ok: true, celdas: candidatas.filter((c) => c.valor !== "") };
}

/**
 * El próximo número de la serie de OS y en qué fila de las altas va, de **una
 * sola lectura**. Es `loQueSigueEnLaSerie` de las OT con el mensaje de las OS.
 *
 * El máximo se cuenta sobre las **dos** pestañas: contar una sola es repartir
 * un número que la otra ya usó. La guarda de las fórmulas mira sólo la del
 * formulario —ahí vive la cadena `=IF(B:B<>"";A{n-1}+1;"")`—, y la fila es la de
 * las altas, que es donde se escribe.
 */
export function loQueSigueEnLaSerieDeOS(
  serieDelFormulario: readonly (readonly unknown[])[],
  serieDeLasAltas: readonly (readonly unknown[])[]
): { ok: true; os_number: number; fila: number } | { ok: false; error: string } {
  if (!laSerieEstaCongelada(serieDelFormulario)) {
    return {
      ok: false,
      error:
        `La columna A de «${HOJA_DE_RESPUESTAS_OS}» todavía numera con una fórmula por ` +
        `fila. Mientras siga así, una OS escrita por el sistema y una respuesta del ` +
        `formulario pueden quedar con el mismo número, así que no se escribe ni se ` +
        `toma número. Hay que pegar esa columna como sólo valores y poner un Apps ` +
        `Script que numere cada respuesta nueva.`,
    };
  }

  return {
    ok: true,
    os_number:
      Math.max(maximoDeLaSerie(serieDelFormulario), maximoDeLaSerie(serieDeLasAltas)) + 1,
    fila: filaSiguienteSegunLaColumna(serieDeLasAltas),
  };
}
