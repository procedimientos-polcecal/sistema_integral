import type { SupabaseClient } from "@supabase/supabase-js";
import { fechaDeSheets } from "@/lib/core/fechaDeSheets";
import { leerValores } from "@/lib/core/sheets";
import { movimientoDesdeElRenglon, type CatalogoDeLaPlanilla } from "./importar";
import { traerCarbonilleros, traerMovimientos } from "./consultas";

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

/* ────────────────────────────────────────────────────────────────────────── */

/** La pestaña de datos. Lleva dos espacios en el medio, y no es un error. */
export const PESTANA = "Entradas  Salidas";

const PLANILLA = () => process.env.GOOGLE_SHEETS_STOCK_CARBONILLA_ID ?? "";

export interface ResumenDeLectura {
  filasLeidas: number;
  nuevos: number;
  cambiadas: number;
  ambiguas: number;
  desaparecidas: number;
  sinReconocer: number;
}

/**
 * Traer de la planilla los movimientos que el libro todavía no tiene.
 *
 * **Lee la planilla entera**, no los últimos N días: son 3.399 filas y una sola
 * lectura, y `sheets_fila` resuelve mejor que una fecha qué hace falta. De paso,
 * así se ve si alguien corrigió una fila vieja.
 *
 * **Lanza si Google falla, y eso es a propósito.** Quien la llama tiene que
 * anotarse como `ok: false` en `sincronizaciones` y no correr el control contra
 * Odoo: una corrida que falla a mitad y se anota bien deja el libro incompleto
 * sin que nada avise, y el control sobre un libro a medias inventa desvíos.
 *
 * Spec: docs/superpowers/specs/2026-10-13-calidad-la-planilla-manda-design.md
 */
export async function leerLaPlanilla(supabase: SupabaseClient): Promise<ResumenDeLectura> {
  if (!PLANILLA()) {
    throw new Error(
      "Falta GOOGLE_SHEETS_STOCK_CARBONILLA_ID: sin eso no se puede leer la planilla de stock."
    );
  }

  const [carbonilleros, movimientos] = await Promise.all([
    traerCarbonilleros(supabase),
    traerMovimientos(supabase),
  ]);

  const catalogo: CatalogoDeLaPlanilla = new Map(
    carbonilleros.map((c) => [c.codigo_planilla, { id: c.id, carbon: c.carbon }])
  );

  // Lo que el SdG ya leyó de cada fila. El signo se devuelve a positivo para
  // poder compararlo con las columnas de la planilla, que no lo tienen.
  const ocupadas = new Map<number, FilaOcupada>();
  for (const m of movimientos) {
    if (m.sheets_fila === null) continue;
    const t = Number(m.toneladas);
    ocupadas.set(m.sheets_fila, {
      fecha: m.fecha,
      entradas: t > 0 ? t : null,
      salidas: t < 0 ? -t : null,
    });
  }

  const filas = await leerValores(PLANILLA(), PESTANA, { sinFormato: true });
  const r = filasPorLeer(ocupadas, filas);

  const nuevos: Record<string, unknown>[] = [];
  const problemas: FilaConProblema[] = [...r.cambiadas, ...r.ambiguas];

  for (const n of r.nuevas) {
    const conv = movimientoDesdeElRenglon(n.celdas, n.fila, catalogo);
    if (conv.clase === "vacia") continue;
    if (conv.clase === "sin_importar") {
      problemas.push(describir(n.fila, n.celdas, conv.motivo));
      continue;
    }
    // `origen` queda en 'importacion', que es lo que dice de dónde vino: de la
    // planilla, igual que los 1.047 de septiembre.
    nuevos.push({ ...conv.movimiento, cargado_por: null });
  }

  for (let i = 0; i < nuevos.length; i += 500) {
    const { error } = await supabase.from("calidad_movimientos").insert(nuevos.slice(i, i + 500));
    if (error) throw new Error(error.message);
  }

  // La bandeja se rehace entera en cada corrida: lo que se arregló en la
  // planilla deja de figurar solo, sin que nadie tenga que ir a borrarlo.
  const { error: errorAlLimpiar } = await supabase
    .from("calidad_planilla_sin_reconocer")
    .delete()
    .gte("fila", 0);
  if (errorAlLimpiar) throw new Error(errorAlLimpiar.message);

  if (problemas.length) {
    const { error } = await supabase.from("calidad_planilla_sin_reconocer").insert(
      problemas.map((p) => ({
        fila: p.fila,
        fecha: p.fecha,
        codigo: p.codigo,
        descripcion: p.descripcion,
        entradas: p.entradas,
        salidas: p.salidas,
        motivo: p.motivo,
      }))
    );
    if (error) throw new Error(error.message);
  }

  return {
    filasLeidas: filas.length,
    nuevos: nuevos.length,
    cambiadas: r.cambiadas.length,
    ambiguas: r.ambiguas.length,
    desaparecidas: r.desaparecidas.length,
    sinReconocer: problemas.length,
  };
}
