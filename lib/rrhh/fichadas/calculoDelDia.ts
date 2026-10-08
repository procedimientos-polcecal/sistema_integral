import type { SupabaseClient } from "@supabase/supabase-js";
import { traerPaginado } from "../paginado";
import type { CalculoDelDia } from "./acreditado";

/**
 * Pega a cada fichada el cálculo que el motor guardó para su (empleado, día).
 *
 * La lista de marcaciones muestra lo acreditado, y lo que el motor decidió
 * —tardanza, retiro anticipado, horas fijadas a mano— está en
 * `calculos_diarios`. Se lee de ahí y no se deduce, y se lee **en un solo
 * lugar**: la página y el refresco de la lista (`GET /api/rrhh/fichadas`)
 * llaman a esta misma función, así que no hay dos caminos que puedan devolver
 * cosas distintas. Si el dato viniera sólo de la página, aparecería al cargar
 * y desaparecería al refrescar.
 *
 * `calculo_dia` queda en:
 * - un objeto, si el motor ya calculó ese día;
 * - `null`, si no hay fila (todavía no se recalculó);
 * - `undefined`, si la tabla no se pudo leer. No lanza: la lista de marcaciones
 *   es útil sin esto, pero tampoco se la hace pasar por "sin calcular".
 */
export type ConCalculoDelDia<T> = T & { calculo_dia: CalculoDelDia | null | undefined };

interface FilaCalculo {
  empleado_id: string;
  fecha: string;
  horas_normales: number | string;
  horas_extra_50: number | string;
  horas_extra_100: number | string;
  tarde: boolean | null;
  retiro_anticipado: boolean | null;
  horas_manual: boolean | null;
}

// Un `.in()` con muchos ids arma una URL que PostgREST rechaza sin explicar por qué.
const LOTE_IDS = 200;

const clave = (empleadoId: string, fecha: string) => `${empleadoId}|${fecha.slice(0, 10)}`;

/** Une filas con sus cálculos por (empleado, día). Pura. */
export function unirCalculos<T extends { empleado_id: string; fecha: string }>(
  filas: T[],
  calculos: FilaCalculo[]
): ConCalculoDelDia<T>[] {
  const porClave = new Map<string, CalculoDelDia>(
    calculos.map((c) => [
      clave(c.empleado_id, c.fecha),
      {
        horas_normales: Number(c.horas_normales),
        horas_extra_50: Number(c.horas_extra_50),
        horas_extra_100: Number(c.horas_extra_100),
        tarde: !!c.tarde,
        retiro_anticipado: !!c.retiro_anticipado,
        horas_manual: !!c.horas_manual,
      },
    ])
  );
  return filas.map((f) => ({ ...f, calculo_dia: porClave.get(clave(f.empleado_id, f.fecha)) ?? null }));
}

export async function conCalculoDelDia<T extends { empleado_id: string; fecha: string }>(
  supabase: SupabaseClient,
  filas: T[]
): Promise<ConCalculoDelDia<T>[]> {
  if (filas.length === 0) return [];

  const ids = [...new Set(filas.map((f) => f.empleado_id))];
  const fechas = filas.map((f) => f.fecha.slice(0, 10)).sort();
  const desde = fechas[0];
  const hasta = fechas[fechas.length - 1];

  try {
    const calculos: FilaCalculo[] = [];
    for (let i = 0; i < ids.length; i += LOTE_IDS) {
      const lote = ids.slice(i, i + LOTE_IDS);
      calculos.push(
        ...(await traerPaginado<FilaCalculo>(
          () =>
            supabase
              .from("calculos_diarios")
              .select("empleado_id, fecha, horas_normales, horas_extra_50, horas_extra_100, tarde, retiro_anticipado, horas_manual")
              .in("empleado_id", lote)
              .gte("fecha", desde)
              .lte("fecha", hasta)
              .order("id"),
          "Leyendo calculos_diarios"
        ))
      );
    }
    return unirCalculos(filas, calculos);
  } catch (err) {
    console.error("[fichadas] no se pudo leer calculos_diarios:", err);
    return filas.map((f) => ({ ...f, calculo_dia: undefined }));
  }
}
