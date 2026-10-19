import { escribirBloque, hastaDondeLlegaLaFormula, leerValores } from "@/lib/core/sheets";
import { COL, celdasDelMovimiento, type MovimientoAEspejar } from "./espejo";

/**
 * La bajada del kardex: el SdG escribe la planilla entera, de una.
 *
 * ── QUÉ ES Y EN QUÉ SE DIFERENCIA DEL ESPEJO ────────────────────────────
 *
 * `espejo.ts` agrega **un movimiento al final** cuando alguien lo carga en la
 * app, y vive en el mundo donde **manda la planilla**. Esto es lo contrario:
 * reescribe el kardex completo con lo que el SdG tiene, y es el primer paso del
 * cambio de dirección acordado el 19/10/2026
 * (`docs/superpowers/specs/2026-10-19-las-planillas-las-llena-el-sistema-design.md`).
 *
 * Los dos no pueden convivir encendidos: mientras el importador siga leyendo,
 * esto le estaría dando de comer su propia salida.
 *
 * ── LO QUE NO SE TOCA, Y POR QUÉ ES TODO EL PROBLEMA ────────────────────
 *
 * El kardex tiene **tres columnas de fórmula intercaladas entre las
 * literales**: la `B` (descripción, un VLOOKUP), la `G` (el stock) y la `K`
 * (grupo, un ARRAYFORMULA). Por eso esto **no** puede ser un
 * `reemplazarPestana()` como el libro de respaldo: borrar la pestaña entera se
 * llevaría las tres y con la `G` se va el stock de todo el módulo.
 *
 * Se escribe en **tres bloques** —`A`, `C:F` y `H:J`—, que es exactamente el
 * complemento de las de fórmula.
 *
 * ── LAS FÓRMULAS LLEGAN HASTA DONDE LLEGAN ──────────────────────────────
 *
 * Y están arrastradas **mucho más abajo que los datos**: medido el 19/10/2026,
 * datos hasta la fila 1.525 y fórmulas hasta la 3.304. Escribir un movimiento
 * por debajo de donde llega la fórmula deja una fila **sin stock y sin que nada
 * avise** —la celda queda en blanco y parece un renglón más—, así que la bajada
 * se niega antes de escribir nada.
 *
 * ── EL ORDEN IMPORTA ────────────────────────────────────────────────────
 *
 * La `G` es un saldo **corrido**: `(stock inicial) + SUMIF($A$2:A2;…)`, o sea
 * la suma de ese código **hasta esta fila**. El total de cada artículo no
 * depende del orden —su última fila incluye todas las anteriores igual— pero
 * los saldos intermedios sí, y son los que alguien mira para entender un
 * movimiento.
 *
 * Por eso se baja **en el orden en que las filas ya están en la planilla**
 * (`sheets_fila`), y no por fecha. Eso le da a la primera corrida una propiedad
 * que vale más que la prolijidad: **sobre un sistema sano tiene que ser casi un
 * no-op**. Si la planilla cambia mucho en la primera bajada, hay una
 * divergencia que conviene mirar *antes* de apagar el importador, no después.
 */

/** Las columnas que escribe la bajada, en bloques contiguos. El complemento
 *  exacto de las de fórmula: B (1), G (6) y K (10). */
export const BLOQUES: { desde: number; hasta: number }[] = [
  { desde: COL.codigo, hasta: COL.codigo },        // A
  { desde: COL.entrada, hasta: COL.despacho },     // C a F
  { desde: COL.fecha, hasta: COL.proveedor },      // H a J
];

/** La primera fila con datos: la 1 es el encabezado. */
export const PRIMERA_FILA = 2;

export interface MovimientoParaBajar extends MovimientoAEspejar {
  /** En qué fila está hoy. `null` si nació en la app y nunca se exportó. */
  sheets_fila: number | null;
  /** Desempata a los que no tienen fila. */
  created_at: string;
}

/**
 * El orden en que van al kardex.
 *
 * Primero los que ya tienen fila, en su orden actual; después los que nacieron
 * en la app, por antigüedad. Así la planilla queda como estaba salvo por lo que
 * efectivamente cambió.
 */
export function ordenarParaLaBajada<T extends { sheets_fila: number | null; created_at: string }>(
  movimientos: T[]
): T[] {
  return [...movimientos].sort((a, b) => {
    if (a.sheets_fila !== null && b.sheets_fila !== null) return a.sheets_fila - b.sheets_fila;
    // Los sin fila van al final, nunca intercalados: intercalarlos correría
    // todas las filas de abajo y la bajada dejaría de ser casi un no-op.
    if (a.sheets_fila === null && b.sheets_fila !== null) return 1;
    if (a.sheets_fila !== null && b.sheets_fila === null) return -1;
    return a.created_at.localeCompare(b.created_at);
  });
}

/**
 * Las filas de cada bloque, ya con los valores tal como van a la celda.
 *
 * **Los valores salen de `celdasDelMovimiento`, que es la función que ya existe
 * y está probada**, y acá sólo se reacomodan. No se reescribe el criterio: ahí
 * están la fecha en ISO (un serial borraría el formato de la celda), el código
 * forzado a texto (`00014` si no queda en 14) y el cero como vacío. Duplicar
 * eso sería tener dos verdades sobre la misma columna.
 */
export function bloquesDeLaBajada(
  movimientos: MovimientoParaBajar[],
  pestana: string
): { desde: number; filas: string[][] }[] {
  const porFila = movimientos.map((m, i) => {
    const celdas = celdasDelMovimiento(m, PRIMERA_FILA + i, pestana);
    const porColumna = new Map(celdas.map((c) => [c.columna, c.valor]));
    return porColumna;
  });

  return BLOQUES.map(({ desde, hasta }) => ({
    desde,
    filas: porFila.map((cols) => {
      const fila: string[] = [];
      for (let c = desde; c <= hasta; c++) fila.push(cols.get(c) ?? "");
      return fila;
    }),
  }));
}

/**
 * Las filas que hay que vaciar porque la bajada quedó más corta que lo que
 * había.
 *
 * Sin esto, borrar un movimiento en el SdG no lo saca de la planilla: queda la
 * cola vieja abajo y el stock la sigue sumando. **Se vacían sólo las columnas
 * literales**, nunca las de fórmula: la `B` y la `G` son
 * `IF(ISBLANK(A);" ";…)`, así que con la `A` vacía se apagan solas y quedan
 * listas por si el kardex vuelve a crecer.
 */
export function filasAVaciar(cuantosMovimientos: number, ultimaFilaConDatos: number): number[] {
  const primeraSobrante = PRIMERA_FILA + cuantosMovimientos;
  const sobrantes: number[] = [];
  for (let f = primeraSobrante; f <= ultimaFilaConDatos; f++) sobrantes.push(f);
  return sobrantes;
}

/** La última fila que tiene algo en la columna A. */
export function ultimaFilaConDatos(columnaA: string[][]): number {
  let ultima = 0;
  for (let i = 0; i < columnaA.length; i++) {
    if (String(columnaA[i]?.[0] ?? "").trim() !== "") ultima = i + 1;
  }
  return ultima;
}

export interface ResultadoBajada {
  ok: boolean;
  movimientos: number;
  /** Hasta qué fila quedó escrito el kardex. */
  ultimaFila: number;
  /** Cuántas filas viejas se vaciaron. */
  vaciadas: number;
  error?: string;
}

const PLANILLA = () => process.env.GOOGLE_SHEETS_ENVASES_ID ?? "";
const TAB = () => process.env.GOOGLE_SHEETS_ENVASES_TAB_MOV ?? "Entradas  Salidas";

/**
 * Escribe el kardex entero.
 *
 * **No lanza: devuelve qué pasó**, con lo que dijo Google sin traducir. Es la
 * misma regla que el espejo y que el resto de las planillas — un fallo de
 * escritura no es un `console.warn`.
 *
 * `planillaId` y `pestana` se pueden pasar para correrlo contra una **copia**,
 * que es como hay que probarlo: escribir en la de producción no se ensaya.
 */
export async function bajarElKardex(
  movimientos: MovimientoParaBajar[],
  opciones: { planillaId?: string; pestana?: string } = {}
): Promise<ResultadoBajada> {
  const planillaId = opciones.planillaId ?? PLANILLA();
  const pestana = opciones.pestana ?? TAB();
  const vacio: ResultadoBajada = { ok: false, movimientos: 0, ultimaFila: 0, vaciadas: 0 };

  if (!planillaId) {
    return { ...vacio, error: "Falta GOOGLE_SHEETS_ENVASES_ID: sin eso no hay a dónde bajar." };
  }

  try {
    const orden = ordenarParaLaBajada(movimientos);
    const ultimaNecesaria = PRIMERA_FILA + orden.length - 1;

    // El freno, antes de escribir nada. La G es la del stock: si no llega, la
    // fila entra sin saldo y no se nota.
    const llegaLaFormula = await hastaDondeLlegaLaFormula(planillaId, pestana, 6);
    if (llegaLaFormula > 0 && ultimaNecesaria > llegaLaFormula) {
      return {
        ...vacio,
        movimientos: orden.length,
        error:
          `La bajada necesita hasta la fila ${ultimaNecesaria} y la fórmula del stock (columna G) ` +
          `sólo llega hasta la ${llegaLaFormula}. Las filas de más entrarían sin stock y sin que ` +
          `nada avise. Hay que arrastrar las fórmulas de B, G y K más abajo en la planilla antes ` +
          `de volver a correr esto.`,
      };
    }

    // Cuánto había antes, para saber qué sobra. Se lee A:A, que corta en la
    // última con contenido y no en la última con fórmula.
    // `sinFormato`, igual que el espejo: lo que importa es si la celda tiene
    // algo, y el valor formateado de un código puede venir distinto.
    const columnaA = await leerValores(planillaId, `${pestana}!A:A`, { sinFormato: true });
    const habiaHasta = ultimaFilaConDatos(columnaA);

    for (const bloque of bloquesDeLaBajada(orden, pestana)) {
      await escribirBloque(planillaId, pestana, bloque.desde, PRIMERA_FILA, bloque.filas);
    }

    const sobrantes = filasAVaciar(orden.length, habiaHasta);
    if (sobrantes.length > 0) {
      for (const { desde, hasta } of BLOQUES) {
        const ancho = hasta - desde + 1;
        await escribirBloque(
          planillaId,
          pestana,
          desde,
          sobrantes[0],
          sobrantes.map(() => Array(ancho).fill("") as string[])
        );
      }
    }

    return {
      ok: true,
      movimientos: orden.length,
      ultimaFila: ultimaNecesaria,
      vaciadas: sobrantes.length,
    };
  } catch (e) {
    return { ...vacio, movimientos: movimientos.length, error: e instanceof Error ? e.message : String(e) };
  }
}
