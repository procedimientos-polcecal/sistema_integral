import { fechaDeSheets } from "@/lib/core/fechaDeSheets";

/**
 * Qué filas de la planilla hay que convertir en movimientos.
 *
 * Función pura: no habla con Sheets ni con Supabase. La corrida que sí lo hace
 * vive más abajo en este mismo archivo.
 *
 * **`sheets_fila` es lo único que evita el lazo.** Cuando alguien carga un
 * consumo en la app, el espejo escribe la fila en la planilla y guarda su
 * número; acá esa fila figura como ocupada y no se vuelve a crear. No hay una
 * segunda defensa —ni una marca en la planilla, ni comparar contenidos para
 * decidir— y es a propósito: una marca más es una cosa más que mantener.
 *
 * Que el número de fila sirva como clave está medido el 13/10/2026 sobre el
 * libro real: 0 filas fuera de orden cronológico en 3.399, y 1.000 de 1.000
 * filas importadas siguen diciendo lo mismo. La planilla se escribe siempre al
 * final.
 *
 * Spec: docs/superpowers/specs/2026-10-13-calidad-la-planilla-manda-design.md
 */

/** Las columnas de `Entradas  Salidas`, por índice. */
const COL = { codigo: 0, descripcion: 1, entradas: 2, salidas: 3, fecha: 7 } as const;

/** Lo que el SdG ya guardó de una fila que leyó. */
export interface FilaOcupada {
  fecha: string;
  /** Positivas, como están en la planilla. `null` si esa columna estaba vacía. */
  entradas: number | null;
  salidas: number | null;
}

export interface FilaNueva {
  fila: number;
  celdas: unknown[];
}

export interface FilaConProblema {
  fila: number;
  fecha: string | null;
  codigo: string;
  descripcion: string;
  entradas: number | null;
  salidas: number | null;
  motivo: string;
}

export interface PorLeer {
  /** Las que hay que convertir con `movimientoDesdeElRenglon`. */
  nuevas: FilaNueva[];
  /** Ya leídas y con otro contenido ahora. No se corrigen solas: se informan. */
  cambiadas: FilaConProblema[];
  /** Con número en las dos columnas: no se sabe si es entrada o salida. */
  ambiguas: FilaConProblema[];
  /** Ocupadas que ya no existen en la planilla. */
  desaparecidas: number[];
}

function numero(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v ?? "").trim();
  if (!s) return null;
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function describir(fila: number, celdas: unknown[], motivo: string): FilaConProblema {
  return {
    fila,
    fecha: fechaDeSheets(celdas[COL.fecha]),
    codigo: String(celdas[COL.codigo] ?? "").trim(),
    descripcion: String(celdas[COL.descripcion] ?? "").trim(),
    entradas: numero(celdas[COL.entradas]),
    salidas: numero(celdas[COL.salidas]),
    motivo,
  };
}

/** Tres decimales, que es `numeric(12,3)` en la base. */
function igual(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return a === b;
  return Math.abs(a - b) < 0.0005;
}

export function filasPorLeer(ocupadas: Map<number, FilaOcupada>, filas: unknown[][]): PorLeer {
  const nuevas: FilaNueva[] = [];
  const cambiadas: FilaConProblema[] = [];
  const ambiguas: FilaConProblema[] = [];

  // La fila 1 es el encabezado; se cuenta desde 1, como la ve una persona.
  filas.slice(1).forEach((celdas, i) => {
    const fila = i + 2;

    const codigo = String(celdas[COL.codigo] ?? "").trim();
    const descripcion = String(celdas[COL.descripcion] ?? "").trim();
    if (!codigo && !descripcion) return;

    const entradas = numero(celdas[COL.entradas]);
    const salidas = numero(celdas[COL.salidas]);

    const ya = ocupadas.get(fila);
    if (ya) {
      // No se corrige sola: cambiar una fila vieja mueve el saldo de todo lo
      // que vino después. Se informa y lo decide una persona.
      if (!igual(ya.entradas, entradas) || !igual(ya.salidas, salidas)) {
        cambiadas.push(
          describir(
            fila,
            celdas,
            `La planilla dice entradas ${entradas ?? "—"} y salidas ${salidas ?? "—"}; ` +
              `el SdG había leído entradas ${ya.entradas ?? "—"} y salidas ${ya.salidas ?? "—"}.`
          )
        );
      }
      return;
    }

    // Con número en las dos columnas no se sabe qué es, y
    // `movimientoDesdeElRenglon` tomaría la entrada perdiendo la salida.
    if (entradas !== null && entradas !== 0 && salidas !== null && salidas !== 0) {
      ambiguas.push(
        describir(fila, celdas, "La fila tiene entrada y salida a la vez: no se sabe cuál es.")
      );
      return;
    }

    nuevas.push({ fila, celdas });
  });

  // Que una ocupada ya no exista no rompe nada ni crea nada: se informa.
  const desaparecidas = [...ocupadas.keys()].filter((f) => f > filas.length).sort((a, b) => a - b);

  return { nuevas, cambiadas, ambiguas, desaparecidas };
}
